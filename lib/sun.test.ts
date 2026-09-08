import { describe, expect, it } from 'vitest';

import {
  describeSunState,
  greenwichSiderealDegrees,
  isSatelliteSunlit,
  nightPolygon,
  satelliteSunState,
  solarCoordinates,
  subsolarPoint,
  sunAltitudeDeg,
  sunEciKm,
  terminatorCurve,
} from '@/lib/sun';

describe('solar geometry', () => {
  const at = new Date('2026-03-20T12:00:00.000Z');

  it('returns finite, bounded solar coordinates and sidereal angle', () => {
    const coordinates = solarCoordinates(at);
    expect(Number.isFinite(coordinates.rightAscension)).toBe(true);
    expect(coordinates.declination).toBeGreaterThanOrEqual(-Math.PI / 2);
    expect(coordinates.declination).toBeLessThanOrEqual(Math.PI / 2);
    expect(greenwichSiderealDegrees(at)).toBeGreaterThanOrEqual(0);
    expect(greenwichSiderealDegrees(at)).toBeLessThan(360);
  });

  it('places the Sun higher near equatorial noon than midnight on the equinox', () => {
    const noon = sunAltitudeDeg(at, 0, 0);
    const midnight = sunAltitudeDeg(new Date('2026-03-20T00:00:00.000Z'), 0, 0);
    expect(noon).toBeGreaterThan(80);
    expect(midnight).toBeLessThan(-80);
  });

  it('classifies day-side, umbral and off-axis satellite positions', () => {
    const sun = sunEciKm(at);
    const length = Math.hypot(sun.x, sun.y, sun.z);
    const unit = { x: sun.x / length, y: sun.y / length, z: sun.z / length };
    const daySide = { x: unit.x * 7_000, y: unit.y * 7_000, z: unit.z * 7_000 };
    const nightSide = { x: -unit.x * 7_000, y: -unit.y * 7_000, z: -unit.z * 7_000 };
    const offAxis = { x: nightSide.x, y: nightSide.y + 8_000, z: nightSide.z };

    expect(isSatelliteSunlit(daySide, at)).toBe(true);
    expect(isSatelliteSunlit(nightSide, at)).toBe(false);
    expect(isSatelliteSunlit(offAxis, at)).toBe(true);
  });
});

describe('subsolar point and terminator', () => {
  const equinoxNoon = new Date('2026-03-20T12:00:00.000Z');
  const equinoxMidnight = new Date('2026-03-20T00:00:00.000Z');
  const juneSolstice = new Date('2026-06-21T12:00:00.000Z');
  const decemberSolstice = new Date('2026-12-21T12:00:00.000Z');

  it('puts the subsolar point near the equator and Greenwich at equinox noon', () => {
    const point = subsolarPoint(equinoxNoon);
    expect(Math.abs(point.lat)).toBeLessThan(1);
    // The equation of time keeps the Sun within a few degrees of the meridian.
    expect(Math.abs(point.lng)).toBeLessThan(5);
  });

  it('moves the subsolar point to the antimeridian at equinox midnight', () => {
    expect(Math.abs(subsolarPoint(equinoxMidnight).lng)).toBeGreaterThan(175);
  });

  it('tilts the subsolar latitude to the tropics at the solstices', () => {
    expect(subsolarPoint(juneSolstice).lat).toBeGreaterThan(23);
    expect(subsolarPoint(juneSolstice).lat).toBeLessThan(23.6);
    expect(subsolarPoint(decemberSolstice).lat).toBeLessThan(-23);
    expect(subsolarPoint(decemberSolstice).lat).toBeGreaterThan(-23.6);
  });

  it('keeps every longitude of the subsolar point inside [-180, 180)', () => {
    for (let hour = 0; hour < 48; hour += 1) {
      const { lng } = subsolarPoint(new Date(equinoxNoon.getTime() + hour * 3_600_000));
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThan(180);
    }
  });

  it('traces the terminator where the Sun sits on the horizon, west to east', () => {
    const curve = terminatorCurve(juneSolstice, 180);
    expect(curve).toHaveLength(181);
    expect(curve[0]![0]).toBe(-180);
    expect(curve[180]![0]).toBe(180);
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index]![0]).toBeGreaterThan(curve[index - 1]![0]);
    }
    // The defining property: along the curve the Sun's altitude is zero.
    for (const [lng, lat] of curve) {
      expect(Math.abs(sunAltitudeDeg(juneSolstice, lat, lng))).toBeLessThan(0.5);
    }
  });

  it('closes the night polygon through the pole in polar night', () => {
    const june = nightPolygon(juneSolstice, 180);
    const december = nightPolygon(decemberSolstice, 180);
    const juneRing = june.coordinates[0]!;
    const decemberRing = december.coordinates[0]!;

    expect(june.type).toBe('Polygon');
    // Curve (181) plus two pole corners plus the closing point.
    expect(juneRing).toHaveLength(184);
    expect(juneRing[0]).toEqual(juneRing[juneRing.length - 1]);
    // Northern summer: the south pole is dark, so the cap closes through it.
    expect(juneRing.some(([, lat]) => lat === -90)).toBe(true);
    expect(juneRing.some(([, lat]) => lat === 90)).toBe(false);
    expect(decemberRing.some(([, lat]) => lat === 90)).toBe(true);
  });

  it('survives the equinox, where the terminator is a pair of meridians', () => {
    const ring = nightPolygon(equinoxNoon, 90).coordinates[0]!;
    for (const [lng, lat] of ring) {
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe('satellite sun state', () => {
  const at = new Date('2026-03-20T12:00:00.000Z');
  const sun = sunEciKm(at);
  const length = Math.hypot(sun.x, sun.y, sun.z);
  const unit = { x: sun.x / length, y: sun.y / length, z: sun.z / length };
  // Any direction perpendicular to the Sun line, for off-axis placements.
  const perpendicular = (() => {
    const raw = { x: -unit.y, y: unit.x, z: 0 };
    const size = Math.hypot(raw.x, raw.y, raw.z);
    return { x: raw.x / size, y: raw.y / size, z: raw.z / size };
  })();
  const place = (alongSun: number, across: number) => ({
    x: unit.x * alongSun + perpendicular.x * across,
    y: unit.y * alongSun + perpendicular.y * across,
    z: unit.z * alongSun + perpendicular.z * across,
  });

  it('reports daylight on the day side with the Sun above the ground horizon', () => {
    const state = satelliteSunState(place(6_800, 0), at);
    expect(state.sunlit).toBe(true);
    expect(state.groundSunAltitudeDeg).toBeGreaterThan(80);
    expect(describeSunState(state)).toMatch(/daylight/i);
  });

  it('reports Earth shadow on the night side with the Sun below the horizon', () => {
    const state = satelliteSunState(place(-6_800, 0), at);
    expect(state.sunlit).toBe(false);
    expect(state.groundSunAltitudeDeg).toBeLessThan(-80);
    expect(describeSunState(state)).toMatch(/shadow/i);
    expect(describeSunState(state)).toMatch(/below/i);
  });

  it('recognises the visible-pass geometry: lit station over a dark ground track', () => {
    // 10° past the terminator plane at ISS altitude: outside the shadow
    // cylinder (6,800 km × cos 10° > Earth's radius) while the ground below
    // is already 10° into night, past civil twilight.
    const radians = (10 * Math.PI) / 180;
    const state = satelliteSunState(place(-6_800 * Math.sin(radians), 6_800 * Math.cos(radians)), at);
    expect(state.sunlit).toBe(true);
    expect(state.groundSunAltitudeDeg).toBeLessThan(-6);
    expect(state.groundSunAltitudeDeg).toBeGreaterThan(-14);
    expect(describeSunState(state)).toMatch(/visible/i);
  });

  it('never produces a non-finite ground altitude for a finite position', () => {
    const state = satelliteSunState({ x: 1, y: 1, z: 1 }, at);
    expect(Number.isFinite(state.groundSunAltitudeDeg)).toBe(true);
  });
});
