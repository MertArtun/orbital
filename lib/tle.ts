import type { TleRecord } from '@/lib/types';

const LINE_1 = /^1\s+(\d{5})[A-Z ]/;
const LINE_2 = /^2\s+(\d{5})\s/;

export class TleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TleParseError';
  }
}

export function parseTleText(input: string): TleRecord[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const records: TleRecord[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const current = lines[cursor];
    if (!current) break;

    let name = 'UNKNOWN SATELLITE';
    let line1: string | undefined;
    let line2: string | undefined;

    if (LINE_1.test(current)) {
      line1 = current;
      line2 = lines[cursor + 1];
      cursor += 2;
    } else {
      name = current.replace(/^0\s+/, '').trim();
      line1 = lines[cursor + 1];
      line2 = lines[cursor + 2];
      cursor += 3;
    }

    if (!line1 || !line2 || !LINE_1.test(line1) || !LINE_2.test(line2)) {
      continue;
    }

    const id1 = line1.match(LINE_1)?.[1];
    const id2 = line2.match(LINE_2)?.[1];
    if (!id1 || id1 !== id2) continue;

    records.push({ name, line1, line2, noradId: id1 });
  }

  if (records.length === 0) {
    throw new TleParseError('The upstream response did not contain a valid TLE set.');
  }

  return records;
}

export function validateTle(record: TleRecord): TleRecord {
  const [parsed] = parseTleText(`${record.name}\n${record.line1}\n${record.line2}`);
  if (!parsed) throw new TleParseError(`Invalid TLE for ${record.name}.`);
  return parsed;
}
