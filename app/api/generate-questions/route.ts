import { NextRequest } from 'next/server'
import { runGenerateQuestions } from '@/lib/ai/generate-questions-run'

// Thin HTTP wrapper. The pipeline lives in lib/ai/generate-questions-run.ts so
// generate-exam can run it in-process instead of fetching this endpoint.
export async function POST(request: NextRequest) {
  return runGenerateQuestions(request)
}
