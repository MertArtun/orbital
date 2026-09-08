'use client';

import { useCallback, useState } from 'react';

import { useClock } from '@/hooks/useClock';
import { clampOffset, simulatedAt } from '@/lib/simulatedTime';

export type SimulatedClock = {
  /**
   * Canonical simulated instant, ms epoch. null until mounted so server and
   * client markup agree.
   */
  at: number | null;
  /** Always clamped to ±MAX_OFFSET_MS. */
  offsetMs: number;
  /** offsetMs === 0. */
  live: boolean;
  setOffsetMs: (offsetMs: number) => void;
  reset: () => void;
};

/**
 * The one place the real clock is read. docs/ARCHITECTURE.md "Time model"
 * gives Phase 2 a single canonical simulated timestamp, so the marker, the
 * ground track, the Starlink worker and every readout take `at` from here and
 * none of them calls `Date.now()` or `new Date()` of its own —
 * lib/simulatedTime.test.ts asserts that on the consumers' source.
 */
export function useSimulatedClock(): SimulatedClock {
  const real = useClock();
  const [offsetMs, setOffset] = useState(0);

  const setOffsetMs = useCallback((next: number) => setOffset(clampOffset(next)), []);
  const reset = useCallback(() => setOffset(0), []);

  return {
    at: real ? simulatedAt(real.getTime(), offsetMs) : null,
    offsetMs,
    live: offsetMs === 0,
    setOffsetMs,
    reset,
  };
}
