import {
  ecfToLookAngles,
  eciToEcf,
  gstime,
  propagate,
  radiansLat,
  radiansLong,
  type SatRec,
} from 'satellite.js';

import { PropagationError, buildSatrec } from '@/lib/propagation';
import { isSatelliteSunlit, sunAltitudeDeg } from '@/lib/sun';
import type { ObserverLocation, TleRecord } from '@/lib/types';

const RAD_TO_DEG = 180 / Math.PI;

export type PassPrediction = {
  id: string;
  start: Date;
  peak: Date;
  end: Date;
  visibleStart: Date | null;
  visibleEnd: Date | null;
  durationSeconds: number;
  visibleDurationSeconds: number;
  maxElevationDeg: number;
  startAzimuthDeg: number;
  peakAzimuthDeg: number;
  endAzimuthDeg: number;
  approachDirection: string;
  departureDirection: string;
  visible: boolean;
  observerDarkAtPeak: boolean;
  sunlitAtPeak: boolean;
};

export type PassOptions = {
  start?: Date;
  hours?: number;
  stepSeconds?: number;
  minVisibleElevationDeg?: number;
  twilightThresholdDeg?: number;
};

export type Observation = {
  at: Date;
  elevationDeg: number;
  azimuthDeg: number;
  eci: { x: number; y: number; z: number };
  observerSunAltitudeDeg: number;
  sunlit: boolean;
};

export function observe(satrec: SatRec, observer: ObserverLocation, at: Date): Observation | null {
  const state = propagate(satrec, at);
  if (!state) return null;

  const gmst = gstime(at);
  const positionEcf = eciToEcf(state.position, gmst);
  const look = ecfToLookAngles(
    {
      latitude: radiansLat(observer.lat),
      longitude: radiansLong(observer.lng),
      height: observer.altitudeKm ?? 0,
    },
    positionEcf,
  );

  const elevationDeg = look.elevation * RAD_TO_DEG;
  const azimuthDeg = ((look.azimuth * RAD_TO_DEG) + 360) % 360;
  // satellite.js signals a decayed orbit with null, but a satrec that went
  // non-finite after it was built yields a truthy state whose components are
  // null — which the `!state` check above cannot see. Left alone, the elevation
  // becomes NaN, `NaN > 0` is false, every sample reads as below the horizon,
  // and the panel reports "no passes" forever with nothing to explain it.
  // propagateSatrec guards the same class for the globe; this is its analogue
  // on the path that calls satellite.js directly.
  if (![elevationDeg, azimuthDeg].every(Number.isFinite)) {
    throw new PropagationError(
      `Observation produced a non-finite look angle at ${at.toISOString()}.`,
    );
  }

  return {
    at,
    elevationDeg,
    azimuthDeg,
    eci: { x: state.position.x, y: state.position.y, z: state.position.z },
    observerSunAltitudeDeg: sunAltitudeDeg(at, observer.lat, observer.lng),
    sunlit: isSatelliteSunlit(state.position, at),
  };
}

export function azimuthToCardinal(azimuthDeg: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8]!;
}

function finalizePass(
  observations: Observation[],
  minVisibleElevationDeg: number,
  twilightThresholdDeg: number,
): PassPrediction | null {
  if (observations.length < 2) return null;

  const peak = observations.reduce((best, sample) =>
    sample.elevationDeg > best.elevationDeg ? sample : best,
  );
  const start = observations[0]!;
  const end = observations[observations.length - 1]!;
  const illuminatedDarkSamples = observations.filter(
    (sample) => sample.sunlit && sample.observerSunAltitudeDeg <= twilightThresholdDeg,
  );
  const visible = peak.elevationDeg >= minVisibleElevationDeg && illuminatedDarkSamples.length > 0;
  const visibleStart = visible ? illuminatedDarkSamples[0]!.at : null;
  const visibleEnd = visible ? illuminatedDarkSamples[illuminatedDarkSamples.length - 1]!.at : null;

  return {
    id: `${start.at.toISOString()}-${Math.round(peak.elevationDeg)}`,
    start: start.at,
    peak: peak.at,
    end: end.at,
    visibleStart,
    visibleEnd,
    durationSeconds: Math.max(0, Math.round((end.at.getTime() - start.at.getTime()) / 1_000)),
    visibleDurationSeconds:
      visibleStart && visibleEnd
        ? Math.max(0, Math.round((visibleEnd.getTime() - visibleStart.getTime()) / 1_000))
        : 0,
    maxElevationDeg: peak.elevationDeg,
    startAzimuthDeg: start.azimuthDeg,
    peakAzimuthDeg: peak.azimuthDeg,
    endAzimuthDeg: end.azimuthDeg,
    approachDirection: azimuthToCardinal(start.azimuthDeg),
    departureDirection: azimuthToCardinal(end.azimuthDeg),
    visible,
    observerDarkAtPeak: peak.observerSunAltitudeDeg <= twilightThresholdDeg,
    sunlitAtPeak: peak.sunlit,
  };
}

export function predictPasses(
  tle: TleRecord,
  observer: ObserverLocation,
  options: PassOptions = {},
): PassPrediction[] {
  const start = options.start ?? new Date();
  const hours = options.hours ?? 72;
  const stepSeconds = Math.max(5, options.stepSeconds ?? 15);
  const minVisibleElevationDeg = options.minVisibleElevationDeg ?? 10;
  const twilightThresholdDeg = options.twilightThresholdDeg ?? -6;
  const endMs = start.getTime() + hours * 3_600_000;
  const satrec = buildSatrec(tle);
  const passes: PassPrediction[] = [];
  let active: Observation[] = [];

  for (let time = start.getTime(); time <= endMs; time += stepSeconds * 1_000) {
    const sample = observe(satrec, observer, new Date(time));
    if (!sample) continue;

    if (sample.elevationDeg > 0) {
      active.push(sample);
      continue;
    }

    if (active.length > 0) {
      const pass = finalizePass(active, minVisibleElevationDeg, twilightThresholdDeg);
      if (pass) passes.push(pass);
      active = [];
    }
  }

  if (active.length > 0) {
    const pass = finalizePass(active, minVisibleElevationDeg, twilightThresholdDeg);
    if (pass) passes.push(pass);
  }

  return passes;
}
