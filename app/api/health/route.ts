import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Liveness probe for the host's health check. Deliberately touches nothing —
// no database, no AI provider. It answers "is this process serving requests",
// which is the only question a restart can fix. Probing a page that reads
// Supabase would turn a brief provider blip into a restart loop.
export function GET() {
  return NextResponse.json({ status: 'ok' })
}
