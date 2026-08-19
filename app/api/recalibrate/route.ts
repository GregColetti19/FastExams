import { NextRequest } from 'next/server'
import { runRecalibrate } from '@/lib/ai/recalibrate-run'

// Thin HTTP wrapper; pipeline lives in lib/ai/recalibrate-run.ts.
export async function POST(request: NextRequest) {
  return runRecalibrate(request)
}
