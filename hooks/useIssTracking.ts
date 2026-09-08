'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { jsonFetcher } from '@/lib/api';
import {
  buildSatrec,
  calculateGroundTrack,
  propagateSatrec,
  type GroundTrackSegment,
  type OrbitalPosition,
} from '@/lib/propagation';
import { isSatelliteSunlit } from '@/lib/sun';
import type { ApiEnvelope, TleRecord } from '@/lib/types';

export type TelemetryPoint = {
  at: number;
  altitudeKm: number;
  speedKmS: number;
};

/** `at` is the canonical simulated instant from useSimulatedClock; null before mount. */
export function useIssTracking(at: number | null) {
  const { data, error, isLoading } = useSWR<ApiEnvelope<TleRecord[]>>(
    '/api/tle/iss',
    jsonFetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      dedupingInterval: 60_000,
    },
  );
  const tle = data?.ok ? data.data[0] : undefined;
  const satrecState = useMemo(() => {
    if (!tle) return { satrec: null, error: null };
    try {
      return { satrec: buildSatrec(tle), error: null };
    } catch (caught) {
      return {
        satrec: null,
        error: caught instanceof Error ? caught.message : 'The ISS TLE could not be parsed.',
      };
    }
  }, [tle]);
  const satrec = satrecState.satrec;
  const [position, setPosition] = useState<OrbitalPosition | null>(null);
  const [track, setTrack] = useState<GroundTrackSegment[]>([]);
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [propagationError, setPropagationError] = useState<string | null>(null);
  const trackCentreRef = useRef<{ tle: TleRecord; at: number } | null>(null);

  useEffect(() => {
    if (!satrec || at === null) return;

    try {
      const next = propagateSatrec(satrec, new Date(at));
      setPosition(next);
      setHistory((current) => {
        const sample = { at, altitudeKm: next.altitudeKm, speedKmS: next.speedKmS };
        const last = current[current.length - 1];
        // The sparkline reads as altitude over the last minute of what is
        // displayed, so it may only grow along contiguous 1Hz ticks. Scrubbing
        // in either direction — or jumping back to now — is a discontinuity,
        // not a minute, so the minute starts again from this sample.
        const contiguous = last !== undefined && at - last.at > 0 && at - last.at <= 1_500;
        return contiguous ? [...current.slice(-59), sample] : [sample];
      });
      setPropagationError(null);
    } catch (caught) {
      setPropagationError(caught instanceof Error ? caught.message : 'Propagation failed.');
    }
  }, [satrec, at]);

  useEffect(() => {
    if (!tle || at === null) return;

    // A track is 90 minutes wide, so recentring it every second would be waste;
    // recentre when the simulated clock has moved a minute from the centre it
    // was computed around. That is the cadence the old 60s interval had, but
    // measured against `at`, so a scrub moves the track at once.
    const centre = trackCentreRef.current;
    if (centre && centre.tle === tle && Math.abs(at - centre.at) < 60_000) return;

    // Trailing 200 ms, real time. The slider moves `at` a whole minute per
    // step, so a drag across the range would otherwise recompute the track —
    // 180 propagations and a paths-layer rebuild — on every step, on the main
    // thread. Waiting for the pointer to pause costs the live case one
    // imperceptible delay per minute.
    const timer = window.setTimeout(() => {
      trackCentreRef.current = { tle, at };
      try {
        setTrack(calculateGroundTrack(tle, new Date(at)));
      } catch (caught) {
        setPropagationError(caught instanceof Error ? caught.message : 'Ground track failed.');
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [tle, at]);

  return {
    tle,
    position,
    track,
    history,
    sunlit: position ? isSatelliteSunlit(position.eci, new Date(position.timestamp)) : null,
    source: data?.ok ? data.source : null,
    stale: data?.ok ? Boolean(data.stale) : false,
    isLoading,
    error: error instanceof Error ? error.message : satrecState.error ?? propagationError,
  };
}
