import type { SatRec } from 'satellite.js';

import type { TleRecord } from '@/lib/types';

/**
 * Upper bound on Starlink satellites propagated and rendered at once. The
 * sample is deterministic so two visitors with the same upstream element set
 * see the same satellites; see sampleStarlink.
 */
export const MAX_STARLINK_POINTS = 800;

/** Floats per satellite in a batch buffer: [lat, lng, altitudeKm]. */
export const STARLINK_STRIDE = 3;

/**
 * Main thread -> worker. `at` is an absolute epoch in milliseconds supplied by
 * the caller; the worker never reads its own clock, so the simulated-time
 * control in P2-02 only has to change what the hook passes here.
 */
export type StarlinkWorkerRequest =
  | { type: 'init'; records: TleRecord[] }
  | { type: 'propagate'; at: number; seq: number };

/**
 * Worker -> main thread. `positions` is transferred, not copied, and holds
 * `count * STARLINK_STRIDE` finite floats; entries past `count` are unused.
 * `skipped` counts satellites whose propagation failed for this tick.
 */
export type StarlinkWorkerResponse =
  | { type: 'ready'; accepted: number; invalid: number }
  | {
      type: 'batch';
      at: number;
      seq: number;
      count: number;
      skipped: number;
      positions: Float32Array;
    }
  | { type: 'error'; message: string; seq: number };

export type StarlinkFleet = {
  satrecs: SatRec[];
  ids: string[];
  /** Records rejected at build time because their elements were unusable. */
  invalid: number;
};

export type FleetBatch = {
  count: number;
  skipped: number;
};

/**
 * Deterministic sample of at most `limit` records: stable sort by numeric
 * NORAD id, then take every `ceil(n / limit)`-th record. The result never
 * exceeds `limit` and is identical for any ordering of the same input.
 */
export function sampleStarlink(records: TleRecord[], limit = MAX_STARLINK_POINTS): TleRecord[] {
  void records;
  void limit;
  throw new Error('not implemented');
}

/**
 * Build satrecs once for a sampled set. A record that lib/propagation's
 * buildSatrec rejects is dropped and counted in `invalid`; it never fails
 * the fleet.
 */
export function buildStarlinkFleet(records: TleRecord[]): StarlinkFleet {
  void records;
  throw new Error('not implemented');
}

/**
 * Propagate every satellite in `fleet` at `atMs`, writing [lat, lng, altKm]
 * triples into `out` from index 0. Longitude is normalised to [-180, 180).
 * A satellite whose propagation fails or produces a non-finite value is
 * skipped and never written, so `out` holds only finite floats for the first
 * `count * STARLINK_STRIDE` entries. Uses one gstime() per call, not one per
 * satellite.
 */
export function propagateFleet(fleet: StarlinkFleet, atMs: number, out: Float32Array): FleetBatch {
  void fleet;
  void atMs;
  void out;
  throw new Error('not implemented');
}
