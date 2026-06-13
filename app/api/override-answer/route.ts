import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'

/**
 * Let a user override the correct answer for a question (past-exam answers are
 * AI-inferred, so users may know better). Marks the chosen option correct, all
 * others incorrect, and records the override on the question.
 *
 * POST { questionId, correctOptionId }
 */
export async function POST(request: NextRequest) {
  try {
    const { questionId, correctOptionId } = await request.json()

    if (!questionId || !correctOptionId) {
      return NextResponse.json(
        { error: 'questionId and correctOptionId required', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient_()

    // Fetch the question's options to validate the target belongs to it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: options } = await (supabase.from('question_options') as any)
      .select('*')
      .eq('question_id', questionId)

    if (!options || options.length === 0) {
      return NextResponse.json(
        { error: 'No options found for question', code: 'NO_OPTIONS' },
        { status: 404 }
      )
    }
    if (!options.some((o: any) => o.id === correctOptionId)) {
      return NextResponse.json(
        { error: 'correctOptionId does not belong to question', code: 'BAD_OPTION' },
        { status: 400 }
      )
    }

    // Flip is_correct: only the chosen option is correct.
    for (const opt of options) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('question_options') as any)
        .update({ is_correct: opt.id === correctOptionId })
        .eq('id', opt.id)
    }

    // Record the override on the question (clears the AI confidence signal).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('questions') as any)
      .update({ answer_status: 'user_set', ai_confidence: null })
      .eq('id', questionId)

    return NextResponse.json({ success: true, questionId, correctOptionId }, { status: 200 })
  } catch (error) {
    console.error('Override-answer error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
