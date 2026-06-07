import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const { questionId, action, subtopicId } = await request.json()

    if (!questionId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient_()

    if (action === 'reassign' && subtopicId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('questions') as any)
        .update({ subtopic_id: subtopicId })
        .eq('id', questionId)
    } else if (action === 'poor_quality') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('questions') as any)
        .update({
          flagged_at: new Date().toISOString(),
          flag_reason: 'poor_quality',
        })
        .eq('id', questionId)
    } else {
      return NextResponse.json(
        { error: 'Invalid action', code: 'INVALID_ACTION' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Flag-question error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
