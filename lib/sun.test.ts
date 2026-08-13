import { describe, expect, it } from 'vitest';

import {
  greenwichSiderealDegrees,
  isSatelliteSunlit,
  solarCoordinates,
  sunAltitudeDeg,
  sunEciKm,
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
