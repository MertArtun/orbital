'use client';

import { useEffect, useRef, useState } from 'react';

import {
  nightPolygon,
  subsolarPoint,
  terminatorCurve,
  type LngLat,
  type NightPolygon,
  type SubsolarPoint,
} from '@/lib/sun';

export type Terminator = {
  at: number;
  subsolar: SubsolarPoint;
  night: NightPolygon;
  curve: LngLat[];
};

/** `at` is the canonical simulated instant from useSimulatedClock; null before mount. */
export function useTerminator(at: number | null): Terminator | null {
  const [terminator, setTerminator] = useState<Terminator | null>(null);
  const centreRef = useRef<number | null>(null);

  useEffect(() => {
    if (at === null) return;

    // The terminator sweeps a quarter degree of longitude a minute, so
    // recomputing it every second would be waste; recompute when the simulated
    // clock has moved a minute from the instant the geometry was built for.
    // Same rule as the ground track's recentre, measured against `at` so a
    // scrub moves the cap at once.
    const centre = centreRef.current;
    if (centre !== null && Math.abs(at - centre) < 60_000) return;

    // Trailing 200 ms, real time. The slider moves `at` a whole minute per
    // step, so a drag across the range would otherwise rebuild the curve, the
    // night polygon and the globe's polygon layer — 181 samples and a full
    // layer digest — on every step, on the main thread. Waiting for the
    // pointer to pause costs the live case one imperceptible delay per minute.
    const timer = window.setTimeout(() => {
      centreRef.current = at;
      const instant = new Date(at);
      setTerminator({
        at,
        subsolar: subsolarPoint(instant),
        night: nightPolygon(instant),
        curve: terminatorCurve(instant, 180),
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [at]);

  return terminator;
}
