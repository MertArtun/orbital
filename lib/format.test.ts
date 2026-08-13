import { describe, expect, it } from 'vitest';

import { formatCoordinate, formatCountdown } from '@/lib/format';

describe('display formatting', () => {
  const now = Date.parse('2026-08-11T00:00:00.000Z');

  it('formats future and elapsed countdowns from absolute timestamps', () => {
    expect(formatCountdown('2026-08-12T01:02:03.000Z', now)).toBe('T−01:01:02:03');
    expect(formatCountdown('2026-08-10T23:59:59.500Z', now)).toBe('T+00:00:00:00');
  });

  it('returns a stable placeholder for malformed timestamps', () => {
    expect(formatCountdown('invalid', now)).toBe('T−--:--:--:--');
  });

  it('formats signed geographic coordinates with hemispheres', () => {
    expect(formatCoordinate(41.0053, 'N', 'S')).toBe('41.01° N');
    expect(formatCoordinate(-28.977, 'E', 'W')).toBe('28.98° W');
  });
});
