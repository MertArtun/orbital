import { NextResponse } from 'next/server';

import { normalizeLaunches } from '@/lib/launches';
import type { ApiEnvelope, Launch } from '@/lib/types';

export const runtime = 'nodejs';
const REVALIDATE_SECONDS = 30 * 60;
let lastGood: Launch[] | null = null;

export async function GET() {
  const url =
    'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=10&ordering=net&hide_recent_previous=true';

  try {
    const response = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': 'ORBITAL/1.0 portfolio dashboard' },
    });
    if (!response.ok) throw new Error(`Launch Library returned ${response.status}.`);
    const launches = normalizeLaunches(await response.json());
    if (launches.length === 0) throw new Error('Launch Library returned no usable launches.');
    lastGood = launches;

    return NextResponse.json(
      {
        ok: true,
        data: launches,
        source: 'live',
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<Launch[]>,
      {
        headers: {
          'Cache-Control': `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=21600`,
        },
      },
    );
  } catch (error) {
    if (lastGood) {
      return NextResponse.json({
        ok: true,
        data: lastGood,
        source: 'stale-memory',
        stale: true,
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<Launch[]>);
    }

    return NextResponse.json(
      {
        ok: false,
        data: [],
        error: error instanceof Error ? error.message : 'Launch data is unavailable.',
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<Launch[]>,
      { status: 503 },
    );
  }
}
