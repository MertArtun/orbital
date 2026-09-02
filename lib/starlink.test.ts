import type { SatRec } from 'satellite.js';
import { describe, expect, it } from 'vitest';

import { buildSatrec, propagateSatrec } from '@/lib/propagation';
import {
  MAX_STARLINK_POINTS,
  STARLINK_STRIDE,
  buildStarlinkFleet,
  propagateFleet,
  sampleStarlink,
} from '@/lib/starlink';
import type { TleRecord } from '@/lib/types';

/**
 * A real Starlink shell-1 element set — 53.05° inclination, ~550 km — used as a
 * column template. makeStarlink splices a new NORAD id, RAAN and mean anomaly
 * into it so a synthetic fleet spreads around the shell instead of stacking
 * every satellite on one point. Checksums are left untouched: neither
 * satellite.js nor lib/tle.ts verifies them.
 */
const TEMPLATE_LINE_1 = '1 44714U 19074B   26244.50000000  .00002182  00000+0  16214-3 0  9995';
const TEMPLATE_LINE_2 = '2 44714  53.0533 156.2384 0001419  85.1230 274.9931 15.06391223 12345';

/**
 * Passes lib/tle.ts's line-prefix validation but carries unparseable numbers —
 * what a truncated CelesTrak GROUP=starlink response looks like by the time it
 * reaches the fleet builder.
 */
const CORRUPT_RECORD: TleRecord = {
  name: 'STARLINK-CORRUPT',
  line1: '1 44900U 19074B   XXXXXXXXXXXXX  .XXXXXXXX  XXXXX+X  XXXXX-X X  XXXX',
  line2: '2 44900  XX.XXXX XXX.XXXX XXXXXXX XXX.XXXX XXX.XXXX XX.XXXXXXXXXXXXXX',
  noradId: '44900',
};

/**
 * The ISS element set from lib/propagation.test.ts, kept here only for its
 * decay boundary: satellite.js returns null for it at DECAYED_AT while the
 * Starlink template still propagates, so a fleet can hold both and exercise
 * the failed-propagation branch at a single instant.
 */
const DECAYING_RECORD: TleRecord = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const AT = Date.UTC(2026, 8, 1, 12, 0, 0);
const DECAYED_AT = Date.UTC(2038, 4, 30, 11, 20, 13);

function angle(degrees: number): string {
  return degrees.toFixed(4).padStart(8, ' ');
}

function makeStarlink(index: number): TleRecord {
  const noradId = String(44_714 + index * 7).padStart(5, '0');

  return {
    name: `STARLINK-${1_000 + index}`,
    line1: `1 ${noradId}${TEMPLATE_LINE_1.slice(7)}`,
    line2:
      `2 ${noradId}${TEMPLATE_LINE_2.slice(7, 17)}${angle((index * 37) % 360)}` +
      `${TEMPLATE_LINE_2.slice(25, 43)}${angle((index * 53) % 360)}${TEMPLATE_LINE_2.slice(51)}`,
    noradId,
  };
}

/** NORAD ids ascend with the index, so records[0] is always the lowest id. */
function makeFleetRecords(count: number): TleRecord[] {
  return Array.from({ length: count }, (_, index) => makeStarlink(index));
}

/** Seeded, so "order-independent" is a reproducible claim and not a coin flip. */
function shuffle(records: TleRecord[]): TleRecord[] {
  const out = [...records];
  let seed = 20_260_901;

  for (let index = out.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const target = seed % (index + 1);
    [out[index], out[target]] = [out[target]!, out[index]!];
  }

  return out;
}

function idsOf(records: TleRecord[]): number[] {
  return records.map((record) => Number(record.noradId));
}

/**
 * Deliberately not a multiple of MAX_STARLINK_POINTS. An even multiple leaves
 * the cap untested: a stride that rounds the step down instead of up still
 * happens to fit, and only a remainder forces the rounding to decide whether
 * the sample overshoots the budget.
 */
const OVERSIZED_FLEET = 2_401;

describe('starlink sampling', () => {
  it('never renders more than the point budget for a fleet far larger than it', () => {
    const sample = sampleStarlink(makeFleetRecords(OVERSIZED_FLEET));

    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(MAX_STARLINK_POINTS);
    expect(new Set(idsOf(sample)).size).toBe(sample.length);
  });

  it('picks the same satellites whatever order the upstream listed them in', () => {
    const records = makeFleetRecords(OVERSIZED_FLEET);

    expect(idsOf(sampleStarlink(shuffle(records)))).toEqual(idsOf(sampleStarlink(records)));
  });

  it('keeps the whole set, ordered by NORAD id, when it already fits the budget', () => {
    const records = makeFleetRecords(12);
    const sample = sampleStarlink(shuffle(records));

    expect(idsOf(sample)).toEqual(idsOf(records));
  });

  it('spreads the sample across the full id range instead of taking a prefix', () => {
    // A `records.slice(0, limit)` implementation passes every assertion above.
    // Only the span check kills it: 800 of 2401 records as a prefix covers a
    // third of the id range, which is a third of the orbital shell on screen.
    const records = makeFleetRecords(OVERSIZED_FLEET);
    const ids = idsOf(records);
    const sample = idsOf(sampleStarlink(records));
    const lowest = ids[0]!;
    const span = ids[ids.length - 1]! - lowest;

    expect(sample[0]).toBe(lowest);
    expect(sample[sample.length - 1]).toBeGreaterThan(lowest + span * 0.99);
  });

  it('breaks a NORAD id tie by the raw id rather than by upstream order', () => {
    // A zero-padded id is numerically equal to its bare form, so the two tie on
    // the primary key and the tie-break is the only thing left to order them.
    // A stable sort keeps ties in upstream order, which would quietly make the
    // sample depend on how the feed happened to list the pair. Unique numeric
    // ids never reach this branch, so no other test covers it.
    const bare: TleRecord = { ...makeStarlink(0), noradId: '44714' };
    const padded: TleRecord = { ...makeStarlink(1), noradId: '044714' };
    const namesOf = (records: TleRecord[]) => records.map((record) => record.name);

    expect(namesOf(sampleStarlink([bare, padded]))).toEqual(
      namesOf(sampleStarlink([padded, bare])),
    );
  });

  it('returns nothing for an empty upstream set', () => {
    // Guards the stride calculation, which divides by the record count.
    expect(sampleStarlink([])).toEqual([]);
  });
});

describe('starlink fleet', () => {
  it('drops a record with unusable elements and counts it instead of failing the fleet', () => {
    const fleet = buildStarlinkFleet([makeStarlink(0), CORRUPT_RECORD, makeStarlink(1)]);

    expect(fleet.satrecs).toHaveLength(2);
    expect(fleet.invalid).toBe(1);
    expect(fleet.ids).toEqual(['44714', '44721']);
  });

  it('writes one finite [lat, lng, altitudeKm] triple per satellite', () => {
    const fleet = buildStarlinkFleet(sampleStarlink(makeFleetRecords(50)));
    const out = new Float32Array(fleet.satrecs.length * STARLINK_STRIDE);

    const batch = propagateFleet(fleet, AT, out);

    expect(batch.count).toBe(50);
    expect(batch.skipped).toBe(0);
    for (let index = 0; index < batch.count; index += 1) {
      const lat = out[index * STARLINK_STRIDE]!;
      const lng = out[index * STARLINK_STRIDE + 1]!;
      const altitudeKm = out[index * STARLINK_STRIDE + 2]!;

      expect(Number.isFinite(lat)).toBe(true);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(Number.isFinite(lng)).toBe(true);
      expect(altitudeKm).toBeGreaterThan(400);
      expect(altitudeKm).toBeLessThan(700);
    }
  });

  it('places a satellite exactly where lib/propagation places it', () => {
    // Every other assertion here is a range check, and a range check cannot see
    // a wrong epoch: solving sidereal time at the wrong instant slides the whole
    // fleet around the equator and leaves each latitude, longitude and altitude
    // inside its plausible band. This is the batch path's only absolute anchor,
    // pinned to the single-satellite path the ISS telemetry already trusts.
    const record = makeStarlink(7);
    const fleet = buildStarlinkFleet([record]);
    const out = new Float32Array(STARLINK_STRIDE);
    const expected = propagateSatrec(buildSatrec(record), new Date(AT));

    propagateFleet(fleet, AT, out);

    // Tolerances are Float32 storage error, not physics: the two paths call the
    // same satellite.js functions, so they agree to double precision before the
    // batch buffer rounds them.
    expect(out[0]!).toBeCloseTo(expected.lat, 4);
    expect(out[1]!).toBeCloseTo(expected.lng, 4);
    expect(out[2]!).toBeCloseTo(expected.altitudeKm, 2);
  });

  it('keeps every longitude in [-180, 180) as the fleet wraps the antimeridian', () => {
    const fleet = buildStarlinkFleet(sampleStarlink(makeFleetRecords(50)));
    const out = new Float32Array(fleet.satrecs.length * STARLINK_STRIDE);
    const longitudes: number[] = [];

    for (let hour = 0; hour < 24; hour += 1) {
      propagateFleet(fleet, AT + hour * 3_600_000, out);
      for (let index = 0; index < fleet.satrecs.length; index += 1) {
        longitudes.push(out[index * STARLINK_STRIDE + 1]!);
      }
    }

    for (const longitude of longitudes) {
      expect(longitude).toBeGreaterThanOrEqual(-180);
      expect(longitude).toBeLessThan(180);
    }
    // What this does NOT prove: that normalizeLongitude ran. satellite.js already
    // wraps eciToGeodetic's longitude into [-pi, pi], so the bound above holds
    // with the call removed. normalizeLongitude only moves the closed upper edge,
    // exactly +180, down to -180, and float propagation never lands there exactly.
    // The value here is the range and the crossing, not the normalisation.
    // Both sides of the seam are actually reached, so the bound above is a real
    // wrap rather than a fleet that never leaves the eastern hemisphere.
    expect(longitudes.some((longitude) => longitude > 170)).toBe(true);
    expect(longitudes.some((longitude) => longitude < -170)).toBe(true);
  });

  it('skips a satellite that propagates to a non-finite state', () => {
    const fleet = buildStarlinkFleet(makeFleetRecords(4));
    const out = new Float32Array(fleet.satrecs.length * STARLINK_STRIDE);
    (fleet.satrecs[1] as unknown as Record<string, number>).no = Number.NaN;

    const batch = propagateFleet(fleet, AT, out);

    expect(batch.count).toBe(3);
    expect(batch.skipped).toBe(1);
    expect(batch.count + batch.skipped).toBe(fleet.satrecs.length);
    // The survivors are compacted from index 0, so a consumer reading the first
    // `count` triples never meets the hole the skipped satellite left behind.
    for (let index = 0; index < batch.count * STARLINK_STRIDE; index += 1) {
      expect(Number.isFinite(out[index]!)).toBe(true);
      expect(out[index]).not.toBe(0);
    }
    // Nothing is written past the live points.
    expect(out[batch.count * STARLINK_STRIDE]).toBe(0);
  });

  it('skips a satellite whose orbit has decayed at the requested instant', () => {
    const fleet = buildStarlinkFleet([makeStarlink(0), DECAYING_RECORD, makeStarlink(1)]);
    const out = new Float32Array(fleet.satrecs.length * STARLINK_STRIDE);

    const batch = propagateFleet(fleet, DECAYED_AT, out);

    expect(fleet.invalid).toBe(0);
    expect(batch.count).toBe(2);
    expect(batch.skipped).toBe(1);
  });

  it('skips a satellite satellite.js throws on rather than losing the whole tick', () => {
    // satellite.js throws, rather than returning null, when a satrec is missing
    // the fields sgp4 reads. One such satellite must not cost the other 799
    // their frame, so the guard is per satellite and not per batch.
    const fleet = buildStarlinkFleet(makeFleetRecords(4));
    const out = new Float32Array(fleet.satrecs.length * STARLINK_STRIDE);
    fleet.satrecs[0] = null as unknown as SatRec;

    const batch = propagateFleet(fleet, AT, out);

    expect(batch.count).toBe(3);
    expect(batch.skipped).toBe(1);
    expect(batch.count + batch.skipped).toBe(fleet.satrecs.length);
  });
});
