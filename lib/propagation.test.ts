import { describe, expect, it } from 'vitest';

import {
  calculateGroundTrack,
  normalizeLongitude,
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
    const segments = calculateGroundTrack(ISS_TLE, new Date('2026-08-09T11:20:13.000Z'), {
      minutesBefore: 45,
      minutesAfter: 45,
      stepSeconds: 60,
    });

    expect(segments.some((segment) => segment.kind === 'past')).toBe(true);
    expect(segments.some((segment) => segment.kind === 'future')).toBe(true);
    expect(segments.flatMap((segment) => segment.points).length).toBeGreaterThan(70);
  });
});
