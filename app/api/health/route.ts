import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'orbital',
    timestamp: new Date().toISOString(),
  });
}
