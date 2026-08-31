import { describe, expect, it } from 'vitest';

import { formatCoordinate, formatCountdown } from '@/lib/format';

describe('display formatting', () => {
  const now = Date.parse('2026-08-11T00:00:00.000Z');

  it('formats future and elapsed countdowns from absolute timestamps', () => {
    expect(formatCountdown('2026-08-12T01:02:03.000Z', now)).toBe('T−01:01:02:03');
    expect(formatCountdown('2026-08-10T23:59:59.500Z', now)).toBe('T+00:00:00:00');
  });

  it('flips sign exactly at zero and holds the boundary second', () => {
    const target = '2026-08-11T00:00:00.000Z';
    const t = Date.parse(target);

    // Counting down: the final second reads zero rather than rolling negative.
    expect(formatCountdown(target, t - 1_000)).toBe('T−00:00:00:01');
    expect(formatCountdown(target, t - 1)).toBe('T−00:00:00:00');
    // Ignition itself is still T−, not T+.
    expect(formatCountdown(target, t)).toBe('T−00:00:00:00');
    // One millisecond later the clock has flipped but not yet advanced.
    expect(formatCountdown(target, t + 1)).toBe('T+00:00:00:00');
    expect(formatCountdown(target, t + 1_000)).toBe('T+00:00:00:01');
  });

  it('returns a stable placeholder for malformed timestamps', () => {
    expect(formatCountdown('invalid', now)).toBe('T−--:--:--:--');
    // The target is guarded; the clock must be too, or a caller passing a
    // parsed timestamp renders "T−NaN:NaN:NaN:NaN" into the launch card.
    expect(formatCountdown('2026-08-11T00:00:00.000Z', Number.NaN)).toBe('T−--:--:--:--');
  });

  it('formats signed geographic coordinates with hemispheres', () => {
    expect(formatCoordinate(41.0053, 'N', 'S')).toBe('41.01° N');
    expect(formatCoordinate(-28.977, 'E', 'W')).toBe('28.98° W');
  });
});
