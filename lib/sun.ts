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
