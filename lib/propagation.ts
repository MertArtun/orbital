import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  type SatRec,
} from 'satellite.js';

import type { TleRecord } from '@/lib/types';

export type OrbitalPosition = {
  lat: number;
  lng: number;
  altitudeKm: number;
  speedKmS: number;
  timestamp: string;
  eci: { x: number; y: number; z: number };
};

export type TrackPoint = {
  lat: number;
  lng: number;
  altitudeKm: number;
  timestamp: string;
};

export type GroundTrackSegment = {
  id: string;
  kind: 'past' | 'future';
  points: TrackPoint[];
};

export class PropagationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropagationError';
  }
}

export function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/**
 * satellite.js reports `error: 0` for element sets whose fields parsed as NaN,
 * so a TLE that survives lib/tle.ts's line-prefix validation but carries
 * unparseable numbers propagates to NaN telemetry instead of failing. These are
 * the elements SGP4 needs; if any is not finite there is nothing to propagate.
 *
 * `jdsatepoch` matters as much as the orbital elements: propagation works from
 * minutes since epoch, so a garbled epoch field makes the whole state NaN while
 * every other element still parses. It is also the only guard that protects
 * lib/passes.ts, which calls satellite.js `propagate` directly and so never
 * reaches the output check in propagateSatrec.
 */
const REQUIRED_ELEMENTS = [
  'no',
  'ecco',
  'inclo',
  'nodeo',
  'argpo',
  'mo',
  'bstar',
  'jdsatepoch',
] as const;

export function buildSatrec(tle: TleRecord): SatRec {
  const satrec = twoline2satrec(tle.line1, tle.line2);
  if (satrec.error !== 0) {
    throw new PropagationError(`satellite.js rejected ${tle.name}; error code ${satrec.error}.`);
  }

  const corrupt = REQUIRED_ELEMENTS.filter((element) => !Number.isFinite(satrec[element]));
  if (corrupt.length > 0) {
    throw new PropagationError(
      `${tle.name} parsed but has unusable orbital elements: ${corrupt.join(', ')}.`,
    );
  }

  return satrec;
}

export function propagateSatrec(satrec: SatRec, date: Date): OrbitalPosition {
  const result = propagate(satrec, date);
  if (!result) {
    throw new PropagationError(`Propagation failed at ${date.toISOString()}.`);
  }

  const gmst = gstime(date);
  const geodetic = eciToGeodetic(result.position, gmst);
  const speedKmS = Math.hypot(result.velocity.x, result.velocity.y, result.velocity.z);

  const lat = degreesLat(geodetic.latitude);
  const lng = normalizeLongitude(degreesLong(geodetic.longitude));
  // A non-finite result is a propagation failure, not a position. Returning it
  // would render NaN across the telemetry panel and hand NaN vertices to three.js.
  // The geodetic values are derived from the ECI position, so checking them
  // covers it; speed comes from velocity and is checked separately.
  if (![lat, lng, geodetic.height, speedKmS].every(Number.isFinite)) {
    throw new PropagationError(`Propagation produced a non-finite state at ${date.toISOString()}.`);
  }

  return {
    lat,
    lng,
    altitudeKm: geodetic.height,
    speedKmS,
    timestamp: date.toISOString(),
    eci: {
      x: result.position.x,
      y: result.position.y,
      z: result.position.z,
    },
  };
}

export function propagateTle(tle: TleRecord, date = new Date()): OrbitalPosition {
  return propagateSatrec(buildSatrec(tle), date);
}

export function splitAtAntimeridian(points: TrackPoint[]): TrackPoint[][] {
  if (points.length === 0) return [];

  const segments: TrackPoint[][] = [[points[0]!]];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = points[index - 1]!;
    const active = segments[segments.length - 1]!;

    if (Math.abs(point.lng - previous.lng) > 180) {
      segments.push([point]);
    } else {
      active.push(point);
    }
  }

  return segments.filter((segment) => segment.length > 1);
}

function sampleTrack(
  satrec: SatRec,
  start: Date,
  end: Date,
  stepSeconds: number,
): TrackPoint[] {
  const result: TrackPoint[] = [];
  const stepMs = Math.max(1, stepSeconds) * 1_000;

  for (let time = start.getTime(); time <= end.getTime(); time += stepMs) {
    const position = propagateSatrec(satrec, new Date(time));
    result.push({
      lat: position.lat,
      lng: position.lng,
      altitudeKm: position.altitudeKm,
      timestamp: position.timestamp,
    });
  }

  return result;
}

export function calculateGroundTrack(
  tle: TleRecord,
  center = new Date(),
  options: { minutesBefore?: number; minutesAfter?: number; stepSeconds?: number } = {},
): GroundTrackSegment[] {
  const minutesBefore = options.minutesBefore ?? 45;
  const minutesAfter = options.minutesAfter ?? 45;
  const stepSeconds = options.stepSeconds ?? 30;
  const satrec = buildSatrec(tle);

  const pastStart = new Date(center.getTime() - minutesBefore * 60_000);
  const futureEnd = new Date(center.getTime() + minutesAfter * 60_000);
  const past = sampleTrack(satrec, pastStart, center, stepSeconds);
  const future = sampleTrack(satrec, center, futureEnd, stepSeconds);

  return [
    ...splitAtAntimeridian(past).map((points, index) => ({
      id: `past-${index}`,
      kind: 'past' as const,
      points,
    })),
    ...splitAtAntimeridian(future).map((points, index) => ({
      id: `future-${index}`,
      kind: 'future' as const,
      points,
    })),
  ];
}
