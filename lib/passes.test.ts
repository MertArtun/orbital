import { describe, expect, it } from 'vitest';

import { azimuthToCardinal, predictPasses } from '@/lib/passes';
import { sunAltitudeDeg } from '@/lib/sun';
import type { ObserverLocation, TleRecord } from '@/lib/types';

const ISS_TLE: TleRecord = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const ISTANBUL: ObserverLocation = {
  id: 'istanbul-test',
  name: 'İstanbul',
  country: 'Türkiye',
  lat: 41.0053,
  lng: 28.977,
};

describe('pass prediction', () => {
  it('maps azimuths to stable compass directions', () => {
    expect(azimuthToCardinal(0)).toBe('N');
    expect(azimuthToCardinal(45)).toBe('NE');
    expect(azimuthToCardinal(180)).toBe('S');
    expect(azimuthToCardinal(315)).toBe('NW');
    expect(azimuthToCardinal(360)).toBe('N');
    expect(azimuthToCardinal(-45)).toBe('NW');
  });

  it('finds chronologically ordered above-horizon passes', () => {
    const passes = predictPasses(ISS_TLE, ISTANBUL, {
      start: new Date('2026-08-09T12:00:00.000Z'),
      hours: 24,
      stepSeconds: 20,
    });

    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      expect(pass.start.getTime()).toBeLessThanOrEqual(pass.peak.getTime());
      expect(pass.peak.getTime()).toBeLessThanOrEqual(pass.end.getTime());
      expect(pass.maxElevationDeg).toBeGreaterThan(0);
      expect(pass.durationSeconds).toBeGreaterThan(0);
    }
    expect(passes.map((pass) => pass.start.getTime())).toEqual(
      [...passes].map((pass) => pass.start.getTime()).sort((a, b) => a - b),
    );
  });

  it('only marks passes visible when darkness, illumination and elevation gates are met', () => {
    const passes = predictPasses(ISS_TLE, ISTANBUL, {
      start: new Date('2026-08-09T12:00:00.000Z'),
      hours: 72,
      stepSeconds: 20,
      minVisibleElevationDeg: 10,
      twilightThresholdDeg: -6,
    });

    for (const pass of passes.filter((candidate) => candidate.visible)) {
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(pass.visibleStart).not.toBeNull();
      expect(pass.visibleEnd).not.toBeNull();
      expect(pass.visibleDurationSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it('can retain geometric passes while disabling visibility with an unreachable elevation gate', () => {
    const passes = predictPasses(ISS_TLE, ISTANBUL, {
      start: new Date('2026-08-09T12:00:00.000Z'),
      hours: 24,
      stepSeconds: 30,
      minVisibleElevationDeg: 91,
    });
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.every((pass) => !pass.visible)).toBe(true);
  });

  it('computes a higher solar altitude near local noon than local midnight', () => {
    const noon = sunAltitudeDeg(new Date('2026-08-09T09:00:00.000Z'), ISTANBUL.lat, ISTANBUL.lng);
    const midnight = sunAltitudeDeg(new Date('2026-08-09T21:00:00.000Z'), ISTANBUL.lat, ISTANBUL.lng);
    expect(noon).toBeGreaterThan(midnight);
  });
});
