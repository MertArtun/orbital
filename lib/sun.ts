const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const EARTH_RADIUS_KM = 6_378.137;
const ASTRONOMICAL_UNIT_KM = 149_597_870.7;

function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function solarCoordinates(date: Date): { rightAscension: number; declination: number } {
  const days = julianDay(date) - 2_451_545.0;
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * days);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * days) * DEG;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * days) * DEG;

  return {
    rightAscension: Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.cos(eclipticLongitude),
    ),
    declination: Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)),
  };
}

export function greenwichSiderealDegrees(date: Date): number {
  const jd = julianDay(date);
  const centuries = (jd - 2_451_545.0) / 36_525;
  return normalizeDegrees(
    280.46061837 +
      360.98564736629 * (jd - 2_451_545.0) +
      0.000387933 * centuries * centuries -
      (centuries * centuries * centuries) / 38_710_000,
  );
}

export function sunAltitudeDeg(date: Date, latDeg: number, lngDeg: number): number {
  const { rightAscension, declination } = solarCoordinates(date);
  const latitude = latDeg * DEG;
  const localSidereal = (greenwichSiderealDegrees(date) + lngDeg) * DEG;
  let hourAngle = localSidereal - rightAscension;
  hourAngle = ((hourAngle + Math.PI) % (2 * Math.PI)) - Math.PI;

  const altitude = Math.asin(
    Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  );

  return altitude * RAD;
}

export function sunEciKm(date: Date): { x: number; y: number; z: number } {
  const days = julianDay(date) - 2_451_545.0;
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * days) * DEG;
  const meanLongitude = normalizeDegrees(280.46 + 0.9856474 * days);
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  const distanceAu = 1.00014 - 0.01671 * Math.cos(meanAnomaly) - 0.00014 * Math.cos(2 * meanAnomaly);
  const distanceKm = distanceAu * ASTRONOMICAL_UNIT_KM;

  return {
    x: distanceKm * Math.cos(eclipticLongitude),
    y: distanceKm * Math.cos(obliquity) * Math.sin(eclipticLongitude),
    z: distanceKm * Math.sin(obliquity) * Math.sin(eclipticLongitude),
  };
}

export function isSatelliteSunlit(
  satelliteEciKm: { x: number; y: number; z: number },
  date: Date,
): boolean {
  const sun = sunEciKm(date);
  const sunLength = Math.hypot(sun.x, sun.y, sun.z);
  const unit = { x: sun.x / sunLength, y: sun.y / sunLength, z: sun.z / sunLength };
  const projection =
    satelliteEciKm.x * unit.x + satelliteEciKm.y * unit.y + satelliteEciKm.z * unit.z;

  if (projection > 0) return true;

  const perpendicular = {
    x: satelliteEciKm.x - projection * unit.x,
    y: satelliteEciKm.y - projection * unit.y,
    z: satelliteEciKm.z - projection * unit.z,
  };

  return Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z) > EARTH_RADIUS_KM;
}

export type SubsolarPoint = { lat: number; lng: number };

/** [lng, lat] in degrees: GeoJSON order, which is what the globe's polygon layer digests. */
export type LngLat = [number, number];

export type NightPolygon = { type: 'Polygon'; coordinates: LngLat[][] };

/**
 * Where the Sun is directly overhead. Latitude is the solar declination;
 * longitude is the Sun's hour angle from Greenwich, so it sweeps west at 15°
 * per hour and a simulated clock moves it exactly as far as the ISS.
 */
export function subsolarPoint(date: Date): SubsolarPoint {
  const { rightAscension, declination } = solarCoordinates(date);
  const lng = normalizeDegrees(rightAscension * RAD - greenwichSiderealDegrees(date));
  return { lat: declination * RAD, lng: lng >= 180 ? lng - 360 : lng };
}

/**
 * The great circle 90° from the subsolar point, sampled at `steps + 1`
 * longitudes from -180 to 180. On the equinox the true terminator is a pair of
 * meridians and the latitude-per-longitude form degenerates, so the subsolar
 * latitude is held a hundredth of a degree off zero: the curve then runs to
 * the poles at the right meridians instead of dividing by zero.
 */
export function terminatorCurve(date: Date, steps = 180): LngLat[] {
  const subsolar = subsolarPoint(date);
  const declination = Math.abs(subsolar.lat) < 0.01 ? Math.sign(subsolar.lat || 1) * 0.01 : subsolar.lat;
  const tanDeclination = Math.tan(declination * DEG);
  const curve: LngLat[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const lng = -180 + (360 * index) / steps;
    const lat = Math.atan(-Math.cos((lng - subsolar.lng) * DEG) / tanDeclination) * RAD;
    curve.push([lng, lat]);
  }

  return curve;
}

/**
 * The night hemisphere as a GeoJSON polygon: the terminator curve closed
 * through whichever pole is in polar night. Below the curve is night when
 * the Sun is north of the equator, above it when the Sun is south, so the cap
 * closes through the south pole in northern summer and the north pole in
 * northern winter.
 *
 * The winding is load-bearing. A ring that encloses a pole has no unambiguous
 * inside in lng/lat, so three-globe's polygon geometry resolves it with
 * d3-geo's geoContains, which follows the right-hand rule: the same points
 * wound the other way fill the daylit hemisphere instead. Closing through the
 * north pole reverses the ring's sense, so that case is reversed back;
 * lib/sun.test.ts pins the sign across the year.
 */
export function nightPolygon(date: Date, steps = 180): NightPolygon {
  const curve = terminatorCurve(date, steps);
  const darkPole = subsolarPoint(date).lat >= 0 ? -90 : 90;
  const open: LngLat[] = [...curve, [180, darkPole], [-180, darkPole]];
  const wound = darkPole > 0 ? open.reverse() : open;
  const ring: LngLat[] = [...wound, wound[0]!];
  return { type: 'Polygon', coordinates: [ring] };
}

export type SunState = {
  /** Outside Earth's shadow cylinder (see isSatelliteSunlit). */
  sunlit: boolean;
  /**
   * The Sun's altitude above the horizon at the point directly beneath the
   * satellite, in degrees. Geocentric: 90° minus the angle between the
   * satellite and the Sun, which is what the shadow model already assumes.
   */
  groundSunAltitudeDeg: number;
};

/**
 * Why the station is lit or not, in numbers the panel can explain. The
 * cylindrical shadow and the geocentric ground altitude are approximations —
 * no penumbra, no refraction, no ellipsoid — good to about a degree, which is
 * the resolution the explanation speaks in.
 */
export function satelliteSunState(
  satelliteEciKm: { x: number; y: number; z: number },
  date: Date,
): SunState {
  const sun = sunEciKm(date);
  const sunLength = Math.hypot(sun.x, sun.y, sun.z);
  const satelliteLength = Math.hypot(satelliteEciKm.x, satelliteEciKm.y, satelliteEciKm.z);
  const cosine =
    (satelliteEciKm.x * sun.x + satelliteEciKm.y * sun.y + satelliteEciKm.z * sun.z) /
    (sunLength * satelliteLength);
  const groundSunAltitudeDeg = 90 - Math.acos(Math.min(1, Math.max(-1, cosine))) * RAD;

  return {
    sunlit: isSatelliteSunlit(satelliteEciKm, date),
    groundSunAltitudeDeg: Number.isFinite(groundSunAltitudeDeg) ? groundSunAltitudeDeg : 0,
  };
}

/** Civil twilight: the darkest sky a naked-eye pass needs, matching lib/passes. */
const CIVIL_TWILIGHT_DEG = -6;

/** One sentence a visitor can act on. */
export function describeSunState(state: SunState): string {
  const altitude = Math.round(Math.abs(state.groundSunAltitudeDeg));
  if (!state.sunlit) {
    return `In Earth's shadow — the Sun is ${altitude}° below the horizon on the ground track.`;
  }
  if (state.groundSunAltitudeDeg <= CIVIL_TWILIGHT_DEG) {
    return `Sunlit over a ground track ${altitude}° into night — the geometry a visible pass needs.`;
  }
  return `In daylight, ${altitude}° of Sun on the ground track too — too bright to spot from below.`;
}
