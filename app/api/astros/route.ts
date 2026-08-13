import { NextResponse } from 'next/server';

import type { ApiEnvelope, AstrosPayload } from '@/lib/types';

export const runtime = 'nodejs';
let lastGood: AstrosPayload | null = null;

export async function GET() {
  try {
    const response = await fetch('http://api.open-notify.org/astros.json', {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Open Notify returned ${response.status}.`);
    const raw = (await response.json()) as {
      number?: number;
      people?: Array<{ name?: string; craft?: string }>;
    };
    const people = (raw.people ?? [])
      .filter((person): person is { name: string; craft: string } => Boolean(person.name && person.craft))
      .map((person) => ({ name: person.name, craft: person.craft }));
    const data = { count: raw.number ?? people.length, people };
    lastGood = data;

    return NextResponse.json({
      ok: true,
      data,
      source: 'live',
      fetchedAt: new Date().toISOString(),
    } satisfies ApiEnvelope<AstrosPayload>);
  } catch (error) {
    if (lastGood) {
      return NextResponse.json({
        ok: true,
        data: lastGood,
        source: 'stale-memory',
        stale: true,
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<AstrosPayload>);
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Astronaut data is unavailable.',
        fetchedAt: new Date().toISOString(),
      } satisfies ApiEnvelope<AstrosPayload>,
      { status: 503 },
    );
  }
}
