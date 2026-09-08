import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_OFFSET_MS,
  clampOffset,
  describeOffset,
  formatOffset,
  simulatedAt,
} from '@/lib/simulatedTime';

const MINUTE = 60_000;

describe('simulated time offset', () => {
  it('is bounded to ninety minutes either side of now', () => {
    expect(MAX_OFFSET_MS).toBe(90 * MINUTE);
    expect(clampOffset(90 * MINUTE)).toBe(90 * MINUTE);
    expect(clampOffset(-90 * MINUTE)).toBe(-90 * MINUTE);
    expect(clampOffset(91 * MINUTE)).toBe(90 * MINUTE);
    expect(clampOffset(-240 * MINUTE)).toBe(-90 * MINUTE);
    expect(clampOffset(15 * MINUTE)).toBe(15 * MINUTE);
  });

  it('treats a non-finite offset as live rather than propagating NaN into the clock', () => {
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampOffset(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('derives the simulated instant from an absolute real timestamp plus the clamped offset', () => {
    const real = Date.UTC(2026, 8, 8, 12, 0, 0);

    expect(simulatedAt(real, 0)).toBe(real);
    expect(simulatedAt(real, 45 * MINUTE)).toBe(real + 45 * MINUTE);
    expect(simulatedAt(real, -45 * MINUTE)).toBe(real - 45 * MINUTE);
    // The clamp is applied here too, so a caller cannot escape the range by
    // bypassing clampOffset.
    expect(simulatedAt(real, 500 * MINUTE)).toBe(real + 90 * MINUTE);
  });

  it('formats the offset for the readout, with zero reading as live', () => {
    expect(formatOffset(0)).toBe('LIVE');
    expect(formatOffset(15 * MINUTE)).toBe('+15 MIN');
    expect(formatOffset(-90 * MINUTE)).toBe('−90 MIN');
    // Anything that is not exactly live is at least one minute away in the
    // readout, so the chip and the readout can never disagree about live.
    expect(formatOffset(20_000)).toBe('+1 MIN');
  });

  it('describes the offset for assistive technology in plain words', () => {
    expect(describeOffset(0)).toBe('live');
    expect(describeOffset(MINUTE)).toBe('1 minute ahead');
    expect(describeOffset(-30 * MINUTE)).toBe('30 minutes behind');
    expect(describeOffset(90 * MINUTE)).toBe('90 minutes ahead');
  });
});

/**
 * Architecture fitness check for docs/ARCHITECTURE.md "Time model": Phase 2
 * has one canonical simulated timestamp and components must not create
 * independent offsets. The only way to guarantee the ISS marker, the ground
 * track and the Starlink worker agree on an instant is that none of them
 * reads a clock of its own -- every consumer receives `at` from the one
 * clock hook. A regression that re-introduces `Date.now()` or `new Date()`
 * into a consumer would silently split the time model again, so it is
 * asserted on the source itself.
 */
describe('canonical clock', () => {
  const consumers = [
    'hooks/useIssTracking.ts',
    'hooks/useStarlink.ts',
    'workers/starlink.worker.ts',
    'components/Globe/GlobeScene.tsx',
    'components/dashboard/OrbitalDashboard.tsx',
    'components/dashboard/TimeControl.tsx',
  ];

  it.each(consumers)('%s reads no clock of its own', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

    expect(source).not.toMatch(/\bDate\.now\(\)/);
    expect(source).not.toMatch(/\bnew Date\(\)/);
  });
});
