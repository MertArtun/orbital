import { NextResponse } from 'next/server';

import fallbackTle from '@/public/data/fallback-tle.json';
import { parseTleText } from '@/lib/tle';
import type { ApiEnvelope, TleRecord } from '@/lib/types';

export const runtime = 'nodejs';

const GROUPS = {
  iss: 'CATNR=25544',
  starlink: 'GROUP=starlink',
  visual: 'GROUP=visual',
} as const;

type Group = keyof typeof GROUPS;
const REVALIDATE_SECONDS = 6 * 60 * 60;
const lastGood = new Map<Group, TleRecord[]>();

function isGroup(value: string): value is Group {
  return value in GROUPS;
}

export async function GET(_request: Request, context: { params: Promise<{ group: string }> }) {
  const { group: rawGroup } = await context.params;
  if (!isGroup(rawGroup)) {
    return NextResponse.json(
      { ok: false, error: `Unknown TLE group: ${rawGroup}`, fetchedAt: new Date().toISOString() },
      { status: 404 },
    );
  }

  const url = `https://celestrak.org/NORAD/elements/gp.php?${GROUPS[rawGroup]}&FORMAT=tle`;

  try {
    const response = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'ORBITAL/1.0 portfolio dashboard' },
    });
    if (!response.ok) throw new Error(`CelesTrak returned ${response.status}.`);

    const records = parseTleText(await response.text());
    lastGood.set(rawGroup, records);
    const payload: ApiEnvelope<TleRecord[]> = {
      ok: true,
      data: records,
      source: 'live',
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    const memory = lastGood.get(rawGroup);
    if (memory) {
      return NextResponse.json({
        ok: true,
        data: memory,
        source: 'stale-memory',
        stale: true,
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<TleRecord[]>);
    }

    if (rawGroup === 'iss') {
      return NextResponse.json({
        ok: true,
        data: fallbackTle.records,
        source: 'repository-fallback',
        stale: true,
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<TleRecord[]>);
    }

    return NextResponse.json(
      {
        ok: false,
        data: [],
        error: error instanceof Error ? error.message : 'TLE data is unavailable.',
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<TleRecord[]>,
      { status: 503 },
    );
  }
}
