import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  type SatRec,
} from 'satellite.js';

import { buildSatrec, normalizeLongitude } from '@/lib/propagation';
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
 * Total order over records. Sorting by numeric id alone is not enough for the
 * order-independence guarantee: a stable sort preserves the upstream order of
 * tied keys, so duplicate or non-numeric ids would sample differently for two
 * listings of the same fleet. The raw id breaks those ties instead.
 */
function compareRecords(left: TleRecord, right: TleRecord): number {
  const leftId = Number(left.noradId);
  const rightId = Number(right.noradId);

  if (leftId !== rightId && Number.isFinite(leftId) && Number.isFinite(rightId)) {
    return leftId - rightId;
  }

  return left.noradId.localeCompare(right.noradId);
}

/**
 * Deterministic sample of at most `limit` records: stable sort by numeric
 * NORAD id, then take every `ceil(n / limit)`-th record. The result never
 * exceeds `limit` and is identical for any ordering of the same input.
 */
export function sampleStarlink(records: TleRecord[], limit = MAX_STARLINK_POINTS): TleRecord[] {
  if (records.length === 0) return [];

  const ordered = [...records].sort(compareRecords);
  const step = Math.ceil(ordered.length / limit);
  const sample: TleRecord[] = [];

  for (let index = 0; index < ordered.length; index += step) {
    sample.push(ordered[index]!);
  }

  return sample;
}

/**
 * Build satrecs once for a sampled set. A record that lib/propagation's
 * buildSatrec rejects is dropped and counted in `invalid`; it never fails
 * the fleet.
 */
export function buildStarlinkFleet(records: TleRecord[]): StarlinkFleet {
  const satrecs: SatRec[] = [];
  const ids: string[] = [];
  let invalid = 0;

  for (const record of records) {
    try {
      satrecs.push(buildSatrec(record));
      ids.push(record.noradId);
    } catch {
      invalid += 1;
    }
  }

  return { satrecs, ids, invalid };
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
  const date = new Date(atMs);
  // Sidereal time depends only on the instant, so it is solved once for the
  // whole fleet rather than 800 times per tick.
  const gmst = gstime(date);
  let count = 0;
  let skipped = 0;

  for (const satrec of fleet.satrecs) {
    try {
      const result = propagate(satrec, date);
      // satellite.js returns null once a satellite is far enough past epoch for
      // sgp4 to report decay -- the ordinary end of an element set's life, not
      // an exceptional one. Testing it costs nothing: without this branch the
      // null would reach eciToGeodetic and land in the same catch below with
      // the same `skipped`, so no test can tell the two apart. It is here to
      // keep the ordinary path from constructing an exception per satellite
      // per tick, which is 800 a second once a whole shell has decayed.
      if (!result) {
        skipped += 1;
        continue;
      }

      const geodetic = eciToGeodetic(result.position, gmst);
      const lat = degreesLat(geodetic.latitude);
      const lng = normalizeLongitude(degreesLong(geodetic.longitude));
      const altitudeKm = geodetic.height;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altitudeKm)) {
        skipped += 1;
        continue;
      }

      // Survivors are compacted from index 0, so a skipped satellite leaves no
      // stale hole for the renderer to read as a position.
      const offset = count * STARLINK_STRIDE;
      out[offset] = lat;
      out[offset + 1] = lng;
      out[offset + 2] = altitudeKm;
      count += 1;
    } catch {
      // satellite.js throws on some element sets rather than returning null.
      // One such satellite must not cost the rest of the fleet its frame.
      skipped += 1;
    }
  }

  return { count, skipped };
}
