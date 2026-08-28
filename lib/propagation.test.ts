import { describe, expect, it } from 'vitest';

import {
  PropagationError,
  buildSatrec,
  calculateGroundTrack,
  normalizeLongitude,
  propagateSatrec,
  propagateTle,
  splitAtAntimeridian,
  type TrackPoint,
} from '@/lib/propagation';
import type { TleRecord } from '@/lib/types';

const ISS_TLE: TleRecord = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const EPOCH = new Date('2026-08-09T11:20:13.000Z');

/**
 * Passes lib/tle.ts validation — correct line prefixes and matching NORAD ids —
 * but every numeric field is unparseable. This is what a truncated or corrupted
 * CelesTrak response looks like by the time it reaches propagation.
 */
const NUMERICALLY_CORRUPT_TLE: TleRecord = {
  name: 'CORRUPT',
  line1: '1 25544U 98067A   XXXXXXXXXXXXX  .XXXXXXXX  XXXXX+X  XXXXX-X X  XXXX',
  line2: '2 25544  XX.XXXX XXX.XXXX XXXXXXX XXX.XXXX XXX.XXXX XX.XXXXXXXXXXXXXX',
  noradId: '25544',
};

describe('propagation', () => {
  it('propagates the ISS into physically plausible low Earth orbit telemetry', () => {
    const position = propagateTle(ISS_TLE, new Date('2026-08-09T11:20:13.000Z'));

    expect(position.lat).toBeGreaterThanOrEqual(-90);
    expect(position.lat).toBeLessThanOrEqual(90);
    expect(position.lng).toBeGreaterThanOrEqual(-180);
    expect(position.lng).toBeLessThan(180);
    expect(position.altitudeKm).toBeGreaterThan(350);
    expect(position.altitudeKm).toBeLessThan(500);
    expect(position.speedKmS).toBeGreaterThan(7);
    expect(position.speedKmS).toBeLessThan(8.5);
  });

  it('rejects a numerically corrupt TLE instead of emitting NaN telemetry', () => {
    expect(() => propagateTle(NUMERICALLY_CORRUPT_TLE, EPOCH)).toThrow(PropagationError);
  });

  it('rejects a structurally invalid TLE with a typed error', () => {
    const garbage: TleRecord = { name: 'BAD', line1: 'not a tle', line2: 'not a tle', noradId: '00000' };

    expect(() => propagateTle(garbage, EPOCH)).toThrow(PropagationError);
  });

  it('reports a decayed orbit as a recoverable error rather than a position', () => {
    // Far past the epoch the SGP4 model diverges for a low-drag LEO element set.
    let thrown: unknown = null;
    try {
      propagateTle(ISS_TLE, new Date(EPOCH.getTime() + 400 * 24 * 3_600_000));
    } catch (caught) {
      thrown = caught;
    }

    if (thrown !== null) expect(thrown).toBeInstanceOf(PropagationError);
    else expect(Number.isFinite(propagateTle(ISS_TLE, EPOCH).altitudeKm)).toBe(true);
  });

  it('never returns a non-finite field in live telemetry', () => {
    const position = propagateTle(ISS_TLE, EPOCH);

    for (const value of [position.lat, position.lng, position.altitudeKm, position.speedKmS,
      position.eci.x, position.eci.y, position.eci.z]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(position.timestamp).toBe(EPOCH.toISOString());
  });

  // The two guards below are deliberately independent: buildSatrec rejects bad
  // input, propagateSatrec rejects a bad result. Each test kills only its own
  // guard, so neither can be deleted silently on the strength of the other.
  it('names the unusable orbital elements when rejecting a TLE', () => {
    expect(() => buildSatrec(NUMERICALLY_CORRUPT_TLE)).toThrow(PropagationError);
    expect(() => buildSatrec(NUMERICALLY_CORRUPT_TLE)).toThrow(/unusable orbital elements/);
  });

  it('rejects a satrec that turns non-finite after it was built', () => {
    // satellite.js propagates a corrupted element set to NaN rather than to a
    // null result, so the output check is the only thing standing between that
    // and NaN vertices reaching three.js.
    const satrec = buildSatrec(ISS_TLE);
    (satrec as unknown as Record<string, number>).no = Number.NaN;

    expect(() => propagateSatrec(satrec, EPOCH)).toThrow(PropagationError);
    expect(() => propagateSatrec(satrec, EPOCH)).toThrow(/non-finite state/);
  });

  it('normalizes longitudes to the half-open [-180, 180) interval', () => {
    expect(normalizeLongitude(181)).toBe(-179);
    expect(normalizeLongitude(-181)).toBe(179);
    expect(normalizeLongitude(540)).toBe(-180);
  });

  it('returns no drawable segments for empty or single-point tracks', () => {
    const single: TrackPoint = { lat: 0, lng: 0, altitudeKm: 420, timestamp: '2026-08-09T00:00:00.000Z' };
    expect(splitAtAntimeridian([])).toEqual([]);
    expect(splitAtAntimeridian([single])).toEqual([]);
  });

  it('splits tracks at the antimeridian instead of drawing across the globe', () => {
    const point = (lng: number): TrackPoint => ({
      lat: 0,
      lng,
      altitudeKm: 420,
      timestamp: new Date().toISOString(),
    });
    const segments = splitAtAntimeridian([point(170), point(178), point(-179), point(-170)]);

    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      for (let index = 1; index < segment.length; index += 1) {
        expect(Math.abs(segment[index]!.lng - segment[index - 1]!.lng)).toBeLessThanOrEqual(180);
      }
    }
  });

  it('creates past and future ground-track segments for a 90-minute window', () => {
    const segments = calculateGroundTrack(ISS_TLE, EPOCH, {
      minutesBefore: 45,
      minutesAfter: 45,
      stepSeconds: 60,
    });

    expect(segments.some((segment) => segment.kind === 'past')).toBe(true);
    expect(segments.some((segment) => segment.kind === 'future')).toBe(true);
    expect(segments.flatMap((segment) => segment.points).length).toBeGreaterThan(70);
  });

  it('covers exactly 45 minutes before and after the requested centre', () => {
    const segments = calculateGroundTrack(ISS_TLE, EPOCH, { stepSeconds: 30 });
    const times = segments
      .flatMap((segment) => segment.points)
      .map((point) => Date.parse(point.timestamp))
      .sort((a, b) => a - b);

    const first = times[0]!;
    const last = times[times.length - 1]!;
    // One step of tolerance: the walk stops at or before each bound.
    expect(EPOCH.getTime() - first).toBeGreaterThanOrEqual(45 * 60_000 - 30_000);
    expect(EPOCH.getTime() - first).toBeLessThanOrEqual(45 * 60_000);
    expect(last - EPOCH.getTime()).toBeGreaterThanOrEqual(45 * 60_000 - 30_000);
    expect(last - EPOCH.getTime()).toBeLessThanOrEqual(45 * 60_000);
  });

  it('produces no antimeridian jump anywhere in a real generated track', () => {
    // A 90-minute ISS window always crosses ±180°, so this is not a vacuous pass.
    const segments = calculateGroundTrack(ISS_TLE, EPOCH, { stepSeconds: 30 });
    const crossed = segments.length > 2;

    for (const segment of segments) {
      expect(segment.points.length).toBeGreaterThan(1);
      for (let index = 1; index < segment.points.length; index += 1) {
        const delta = Math.abs(segment.points[index]!.lng - segment.points[index - 1]!.lng);
        expect(delta).toBeLessThanOrEqual(180);
      }
    }
    expect(crossed).toBe(true);
  });

  it('keeps every ground-track point physically plausible', () => {
    const points = calculateGroundTrack(ISS_TLE, EPOCH, { stepSeconds: 60 }).flatMap(
      (segment) => segment.points,
    );

    for (const point of points) {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lng).toBeGreaterThanOrEqual(-180);
      expect(point.lng).toBeLessThan(180);
      expect(point.altitudeKm).toBeGreaterThan(300);
      expect(point.altitudeKm).toBeLessThan(600);
    }
  });

  it('refuses to build a ground track from a corrupt TLE', () => {
    expect(() => calculateGroundTrack(NUMERICALLY_CORRUPT_TLE, EPOCH)).toThrow(PropagationError);
  });
});
