import { NextRequest, NextResponse } from 'next/server'
import { getFileStore } from '@/lib/supabase/mock/persist'
import { executeQuery, executeStorage } from '@/lib/supabase/mock/query'
import { isMockDb } from '@/lib/supabase/mock-mode'

// Shared mock-DB endpoint for the browser client. Only active in DB_MODE=mock;
// returns 404 otherwise so it can never leak into a cloud deployment.
export async function POST(request: NextRequest) {
  if (!isMockDb()) {
    return NextResponse.json({ error: 'dev-db disabled', code: 'NOT_MOCK' }, { status: 404 })
  }

  const body = await request.json()
  const store = getFileStore()

  if (body.type === 'query') {
    return NextResponse.json(executeQuery(store, body.spec))
  }
  if (body.type === 'storage') {
    return NextResponse.json(executeStorage(store, body.spec))
  }
  return NextResponse.json({ data: null, error: { message: 'unknown op' } }, { status: 400 })
}
