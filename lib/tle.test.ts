import { describe, expect, it } from 'vitest';

import { parseTleText, TleParseError, validateTle } from '@/lib/tle';

const LINE_1 = '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992';
const LINE_2 = '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019';

describe('TLE parsing', () => {
  it('parses named three-line elements and strips an optional line-zero prefix', () => {
    const records = parseTleText(`0 ISS (ZARYA)\n${LINE_1}\n${LINE_2}\n`);

    expect(records).toEqual([
      {
        name: 'ISS (ZARYA)',
        line1: LINE_1,
        line2: LINE_2,
        noradId: '25544',
      },
    ]);
  });

  it('accepts unnamed two-line sets', () => {
    expect(parseTleText(`${LINE_1}\n${LINE_2}`)[0]?.name).toBe('UNKNOWN SATELLITE');
  });

  it('skips malformed records while preserving a later valid record', () => {
    const records = parseTleText(`BROKEN\nnot tle\nstill broken\nISS\n${LINE_1}\n${LINE_2}`);
    expect(records).toHaveLength(1);
    expect(records[0]?.noradId).toBe('25544');
  });

  it('rejects responses with no valid matching NORAD pair', () => {
    const mismatched = LINE_2.replace('25544', '12345');
    expect(() => parseTleText(`ISS\n${LINE_1}\n${mismatched}`)).toThrow(TleParseError);
  });

  it('round-trips a valid record through validation', () => {
    expect(
      validateTle({ name: 'ISS', line1: LINE_1, line2: LINE_2, noradId: 'ignored' }),
    ).toMatchObject({ name: 'ISS', noradId: '25544' });
  });
});
