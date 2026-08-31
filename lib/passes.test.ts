import { describe, expect, it } from 'vitest';

import { azimuthToCardinal, observe, predictPasses } from '@/lib/passes';
import { PropagationError, buildSatrec } from '@/lib/propagation';
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

/** Chosen because it contains real night passes over Istanbul; see the visibility test. */
const VISIBLE_WINDOW_START = new Date('2026-08-18T12:00:00.000Z');

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
    // Visible passes come in seasons: whether the orbit plane meets the
    // terminator over a given site cycles over weeks. The window starting
    // 2026-08-09 contains 21 above-horizon passes and no visible ones, so a
    // test written against it asserts nothing at all. This window, nine days
    // later and still close to the TLE epoch, contains real night passes.
    const passes = predictPasses(ISS_TLE, ISTANBUL, {
      start: VISIBLE_WINDOW_START,
      hours: 72,
      stepSeconds: 20,
      minVisibleElevationDeg: 10,
      twilightThresholdDeg: -6,
    });

    const visible = passes.filter((candidate) => candidate.visible);
    // Guards the assertions below against silently iterating an empty list.
    expect(visible.length).toBeGreaterThan(0);

    for (const pass of visible) {
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(pass.visibleStart).not.toBeNull();
      expect(pass.visibleEnd).not.toBeNull();
      expect(pass.visibleDurationSeconds).toBeGreaterThanOrEqual(0);
      // The illuminated-and-dark window is a sub-interval of the pass, not the
      // whole of it. Deliberately not asserted via sunlitAtPeak: this fixture
      // contains a pass (2026-08-21T00:37Z) whose peak is inside Earth's shadow
      // and which only becomes visible two minutes later as the ISS leaves
      // eclipse. The peak flags are diagnostics; the gates are pinned
      // independently by the single-gate test below.
      expect(pass.visibleStart!.getTime()).toBeGreaterThanOrEqual(pass.start.getTime());
      expect(pass.visibleEnd!.getTime()).toBeLessThanOrEqual(pass.end.getTime());
      expect(pass.visibleStart!.getTime()).toBeLessThanOrEqual(pass.visibleEnd!.getTime());

      // Those three are ordering invariants, not gates: visibleStart and
      // visibleEnd come from a filtered subarray, so they cannot fall outside
      // the pass or invert. Sample the boundary itself to pin illumination and
      // darkness at the moment the window opens — without this the `sunlit`
      // term can be deleted from finalizePass and the whole suite stays green.
      const atVisibleStart = observe(buildSatrec(ISS_TLE), ISTANBUL, pass.visibleStart!)!;
      expect(atVisibleStart.sunlit).toBe(true);
      expect(atVisibleStart.observerSunAltitudeDeg).toBeLessThanOrEqual(-6);
    }
  });

  it('withholds visibility from passes that fail exactly one gate', () => {
    const options = {
      start: VISIBLE_WINDOW_START,
      hours: 72,
      stepSeconds: 20,
      twilightThresholdDeg: -6,
    };
    const baseline = predictPasses(ISS_TLE, ISTANBUL, {
      ...options,
      minVisibleElevationDeg: 10,
    }).filter((pass) => pass.visible);
    expect(baseline.length).toBeGreaterThan(0);

    // Raising only the elevation gate above every observed peak must remove
    // every visible pass while leaving the geometric passes untouched.
    const highest = Math.max(...baseline.map((pass) => pass.maxElevationDeg));
    const gated = predictPasses(ISS_TLE, ISTANBUL, {
      ...options,
      minVisibleElevationDeg: highest + 1,
    });
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.filter((pass) => pass.visible)).toEqual([]);

    // Demanding full darkness the Sun never reaches removes them too, which
    // pins the twilight gate independently of the elevation gate.
    const darkGated = predictPasses(ISS_TLE, ISTANBUL, {
      ...options,
      minVisibleElevationDeg: 10,
      twilightThresholdDeg: -90,
    });
    expect(darkGated.filter((pass) => pass.visible)).toEqual([]);
  });

  it('gates and reports elevation from the observable window, not the geometric peak', () => {
    // The three gates must describe the same moment. Filtering elevation from
    // the whole-pass peak while filtering illumination and darkness separately
    // lets a pass qualify on a peak that happens in daylight or in eclipse: for
    // Toronto in this window one pass peaks at 75.9 deg but its only sunlit,
    // dark window sits at 10.8 deg, and across lib/cities.ts 66 passes were
    // marked visible whose observable window never reaches 10 deg at all.
    const toronto: ObserverLocation = {
      id: 'toronto-test',
      name: 'Toronto',
      country: 'Canada',
      lat: 43.6532,
      lng: -79.3832,
    };
    const passes = predictPasses(ISS_TLE, toronto, {
      start: VISIBLE_WINDOW_START,
      hours: 72,
      stepSeconds: 15,
      minVisibleElevationDeg: 10,
      twilightThresholdDeg: -6,
    });

    const visible = passes.filter((pass) => pass.visible);
    expect(visible.length).toBeGreaterThan(0);

    for (const pass of visible) {
      expect(pass.visibleMaxElevationDeg).not.toBeNull();
      // The gate applies to what the observer can actually see...
      expect(pass.visibleMaxElevationDeg!).toBeGreaterThanOrEqual(10);
      // ...and can never exceed the geometric peak of the same pass.
      expect(pass.visibleMaxElevationDeg!).toBeLessThanOrEqual(pass.maxElevationDeg);
    }

    // A pass whose geometric peak clears the gate but whose observable window
    // does not must not be reported as visible. Toronto has no such pass in
    // this window, so asserting it there proves nothing — Bitlis does: one pass
    // peaks at 11.7 deg while its observable window never rises above 1.9 deg,
    // which the old peak-based gate reported as a visible pass.
    const bitlis: ObserverLocation = {
      id: 'bitlis-test',
      name: 'Bitlis',
      country: 'Türkiye',
      lat: 38.3938,
      lng: 42.1232,
    };
    const overstated = predictPasses(ISS_TLE, bitlis, {
      start: VISIBLE_WINDOW_START,
      hours: 72,
      stepSeconds: 15,
      minVisibleElevationDeg: 10,
      twilightThresholdDeg: -6,
    }).filter(
      (pass) =>
        pass.maxElevationDeg >= 10 &&
        pass.visibleMaxElevationDeg !== null &&
        pass.visibleMaxElevationDeg < 10,
    );

    expect(overstated.length).toBeGreaterThan(0);
    expect(overstated.every((pass) => !pass.visible)).toBe(true);
  });

  it('rejects a non-finite observation instead of silently reporting no passes', () => {
    // A satrec that goes non-finite after a valid build is the one case
    // buildSatrec's input guards cannot catch. satellite.js then returns a
    // truthy state whose position components are NaN rather than returning
    // null, so `if (!state)` misses it, the elevation becomes NaN, and
    // `NaN > 0` is false — every sample reads as below the horizon and the
    // panel reports "no passes" forever with no error to explain it.
    const satrec = buildSatrec(ISS_TLE);
    (satrec as unknown as Record<string, number>).no = Number.NaN;

    expect(() => observe(satrec, ISTANBUL, VISIBLE_WINDOW_START)).toThrow(PropagationError);
  });

  it('bounds every pass to the requested window', () => {
    const hours = 72;
    const passes = predictPasses(ISS_TLE, ISTANBUL, {
      start: VISIBLE_WINDOW_START,
      hours,
      stepSeconds: 30,
    });

    const endMs = VISIBLE_WINDOW_START.getTime() + hours * 3_600_000;
    expect(passes.length).toBeGreaterThan(0);
    for (const pass of passes) {
      expect(pass.start.getTime()).toBeGreaterThanOrEqual(VISIBLE_WINDOW_START.getTime());
      expect(pass.end.getTime()).toBeLessThanOrEqual(endMs);
    }
  });

  it('can retain geometric passes while disabling visibility with an unreachable elevation gate', () => {
    // Must run on a window that actually has visible passes, or it holds no
    // matter what the elevation gate does.
    const passes = predictPasses(ISS_TLE, ISTANBUL, {
      start: VISIBLE_WINDOW_START,
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
