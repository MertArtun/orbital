/**
 * The simulated clock's contract. docs/ARCHITECTURE.md "Time model" requires
 * one canonical simulated timestamp; the numbers here are the whole of what
 * the clock hook, the controls and the readout agree on, so they live outside
 * all three.
 */

export const MAX_OFFSET_MINUTES = 90;

/** Furthest the simulated clock may sit from now, either way. */
export const MAX_OFFSET_MS = MAX_OFFSET_MINUTES * 60_000;

/** One press of the rewind/advance buttons. */
export const OFFSET_STEP_MS = 10 * 60_000;

/**
 * Bounds an offset to ±MAX_OFFSET_MS. A non-finite offset becomes live (0)
 * rather than a NaN instant that would reach SGP4 and every countdown.
 */
export function clampOffset(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.min(MAX_OFFSET_MS, Math.max(-MAX_OFFSET_MS, offsetMs));
}

/** The simulated instant: an absolute real epoch plus the clamped offset. */
export function simulatedAt(realNowMs: number, offsetMs: number): number {
  return realNowMs + clampOffset(offsetMs);
}

/**
 * Whole minutes away from now, never zero unless the offset is exactly zero:
 * the live state is `offsetMs === 0`, and a readout that rounded 20 s to
 * "LIVE" would contradict the chip that says otherwise.
 */
function offsetMinutes(offsetMs: number): number {
  return Math.max(1, Math.round(Math.abs(offsetMs) / 60_000));
}

/** Readout text: `LIVE`, `+15 MIN`, `−90 MIN`. */
export function formatOffset(offsetMs: number): string {
  if (offsetMs === 0) return 'LIVE';
  return `${offsetMs > 0 ? '+' : '−'}${offsetMinutes(offsetMs)} MIN`;
}

/** Slider value text for assistive technology: `live`, `15 minutes ahead`. */
export function describeOffset(offsetMs: number): string {
  if (offsetMs === 0) return 'live';
  const minutes = offsetMinutes(offsetMs);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ${offsetMs > 0 ? 'ahead' : 'behind'}`;
}
