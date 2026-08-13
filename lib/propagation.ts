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

export function buildSatrec(tle: TleRecord): SatRec {
  const satrec = twoline2satrec(tle.line1, tle.line2);
  if (satrec.error !== 0) {
    throw new PropagationError(`satellite.js rejected ${tle.name}; error code ${satrec.error}.`);
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

  return {
    lat: degreesLat(geodetic.latitude),
    lng: normalizeLongitude(degreesLong(geodetic.longitude)),
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
