'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { jsonFetcher } from '@/lib/api';
import type { StarlinkWorkerRequest, StarlinkWorkerResponse } from '@/lib/starlink';
import type { ApiEnvelope, TleRecord } from '@/lib/types';

/**
 * Narrower on purpose than useLaunches, useIssTracking and useAstros, which
 * also return `source` and `stale`: those feed panels that render a CACHED
 * chip, and this layer has no surface for feed staleness yet. The worker still
 * reports accepted, invalid and skipped on the wire, and lib/starlink.test.ts
 * covers them there; they come back here with the UI that shows them.
 */
export type StarlinkState = {
  /** [lat, lng, altitudeKm] triples for the first `count` satellites. */
  positions: Float32Array | null;
  count: number;
  /**
   * The worker has answered for the current fleet. An empty answer is still an
   * answer, so this is what separates "still working" from "nothing to draw".
   */
  ready: boolean;
  isLoading: boolean;
  error: string | null;
};

type Batch = Pick<StarlinkState, 'positions' | 'count'>;

const NO_BATCH: Batch = { positions: null, count: 0 };

/**
 * Schedules Starlink propagation on a worker. Everything expensive — building
 * satrecs, sampling, SGP4 — lives in the worker; this hook only owns the SWR
 * key and the lifetime of the worker. It owns no clock: `at` is the canonical
 * simulated instant from useSimulatedClock, and each new value is one request.
 */
export function useStarlink(enabled: boolean, at: number | null): StarlinkState {
  // Latches on first enable so the key never returns to null: toggling the
  // layer off and on again is then served from the SWR cache rather than
  // refetching an element set of several hundred kilobytes.
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (enabled) setRequested(true);
  }, [enabled]);

  const { data, error, isLoading } = useSWR<ApiEnvelope<TleRecord[]>>(
    requested ? '/api/tle/starlink' : null,
    jsonFetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: true,
      errorRetryCount: 2,
      dedupingInterval: 60_000,
    },
  );
  const records = data?.ok ? data.data : undefined;

  const [batch, setBatch] = useState<Batch>(NO_BATCH);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Monotonic across worker lifetimes, so a fleet swap cannot mint a sequence
  // number the previous worker has already answered with.
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled || !records) return;

    let worker: Worker;
    try {
      // This literal `new URL(..., import.meta.url)` form is what the bundler
      // statically resolves; a computed specifier emits no worker chunk at all.
      worker = new Worker(new URL('../workers/starlink.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (caught) {
      setWorkerError(
        caught instanceof Error ? caught.message : 'The Starlink layer could not start.',
      );
      return;
    }

    workerRef.current = worker;

    let applied = 0;
    worker.onmessage = (event: MessageEvent<StarlinkWorkerResponse>) => {
      // A reply already queued when this worker was terminated must not land
      // on the fleet that replaced it.
      if (workerRef.current !== worker) return;
      const message = event.data;
      if (message.type === 'ready') {
        // Its counts are not rendered, but its arrival says the worker built
        // this fleet: a failure belonging to an earlier one ends here.
        setWorkerError(null);
        return;
      }
      if (message.type === 'error') {
        setWorkerError(message.message);
        return;
      }
      // Replies arrive in the order the worker produced them, so a batch that
      // took longer than a tick is still newer than what is on screen. Compare
      // against the last batch applied, not the last request sent: comparing
      // against `seqRef` discards every reply once a round trip exceeds 1Hz.
      if (message.seq <= applied) return;
      applied = message.seq;
      // The worker is answering again, so an earlier failure is over. Left
      // uncleared it pins the label to "unavailable" while satellites move.
      setWorkerError(null);
      setBatch({ positions: message.positions, count: message.count });
    };
    worker.onerror = () => setWorkerError('The Starlink layer stopped responding.');

    worker.postMessage({ type: 'init', records } satisfies StarlinkWorkerRequest);

    return () => {
      workerRef.current = null;
      worker.terminate();
      setBatch(NO_BATCH);
      setWorkerError(null);
    };
  }, [enabled, records]);

  // Keyed on the fleet as well as the clock: a new worker has to be asked for
  // its first batch here rather than waiting for the next tick of `at`.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || at === null) return;

    seqRef.current += 1;
    // An absolute epoch, never a tick count: the simulated clock reaches the
    // worker as `at`, and the worker reads no clock of its own (ADR 0005).
    const request: StarlinkWorkerRequest = { type: 'propagate', at, seq: seqRef.current };
    worker.postMessage(request);
  }, [at, enabled, records]);

  return {
    ...batch,
    ready: batch.positions !== null,
    isLoading: enabled && isLoading,
    error: error instanceof Error ? error.message : workerError,
  };
}
