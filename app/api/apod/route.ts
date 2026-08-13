import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
  try {
    const response = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${apiKey}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`NASA APOD returned ${response.status}.`);
    return NextResponse.json(await response.json(), {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'APOD is unavailable.' },
      { status: 503 },
    );
  }
}
