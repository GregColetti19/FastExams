import { NextRequest, NextResponse } from 'next/server'
import { processFileById } from '@/lib/processing/process-file'

// Thin HTTP wrapper. The work lives in lib/processing/process-file.ts so the
// upload route can run it in-process instead of fetching this endpoint.
export async function POST(request: NextRequest) {
  try {
    const { fileId } = await request.json()

    if (!fileId) {
      return NextResponse.json({ error: 'fileId required', code: 'MISSING_FILE_ID' }, { status: 400 })
    }

    const result = await processFileById(fileId)

    if (!result.ok) {
      return NextResponse.json(
        { success: false, fileId, error: result.error, code: result.code },
        { status: result.code === 'FILE_NOT_FOUND' ? 404 : 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        fileId,
        chunksCreated: result.chunksCreated,
        language: result.language,
        converterUsed: result.converterUsed,
        processingStatus: 'ready',
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Process-file endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
