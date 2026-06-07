import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { calculateNextReview, getMasteryScore } from '@/lib/scheduling/spaced-repetition'

export async function POST(request: NextRequest) {
  try {
    const { sessionId, questionId, selectedOptionId, isCorrect, timeSpentSeconds } = await request.json()

    if (!sessionId || !questionId || isCorrect === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient_()

    // Insert attempt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: attemptError } = await (supabase
      .from('question_attempts') as any)
      .insert([
        {
          session_id: sessionId,
          question_id: questionId,
          selected_option_id: selectedOptionId || null,
          is_correct: isCorrect,
          time_spent_seconds: timeSpentSeconds || null,
        },
      ])
      .select() as any

    if (attemptError) {
      console.error('Failed to insert attempt:', attemptError)
      return NextResponse.json(
        { error: 'Failed to record attempt', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    // Fetch current question schedule
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: question } = await (supabase.from('questions') as any)
      .select('*')
      .eq('id', questionId)
      .single() as any

    if (!question) {
      return NextResponse.json({ error: 'Question not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    // Calculate next review
    const schedule = {
      timesCorrect: question.times_correct,
      timesSeen: question.times_seen,
      currentIntervalDays: question.current_interval_days,
      lastSeenAt: question.last_seen_at ? new Date(question.last_seen_at) : null,
    }

    const update = calculateNextReview(schedule, isCorrect)

    // Update question scheduling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('questions') as any)
      .update({
        times_seen: update.timesSeen,
        times_correct: update.timesCorrect,
        current_interval_days: update.currentIntervalDays,
        last_seen_at: new Date().toISOString(),
        next_review_at: update.nextReviewAt.toISOString(),
      })
      .eq('id', questionId)

    // Update session
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: session } = await (supabase.from('study_sessions') as any)
      .select('*')
      .eq('id', sessionId)
      .single() as any

    if (session) {
      const newCorrectCount = isCorrect ? session.correct_count + 1 : session.correct_count
      const newTotalCount = session.total_questions + 1

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('study_sessions') as any)
        .update({
          total_questions: newTotalCount,
          correct_count: newCorrectCount,
        })
        .eq('id', sessionId)
    }

    // If question has a subtopic, recalculate mastery score
    if (question.subtopic_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: allAttempts } = await (supabase.from('question_attempts') as any)
        .select('is_correct')
        .eq('question_id', questionId) as any

      if (allAttempts) {
        const correctCount = allAttempts.filter((a: any) => a.is_correct).length
        const masteryScore = getMasteryScore(correctCount, allAttempts.length)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('subtopics') as any)
          .update({ mastery_score: masteryScore })
          .eq('id', question.subtopic_id)
      }
    }

    return NextResponse.json(
      {
        success: true,
        nextReviewAt: update.nextReviewAt,
        intervalDays: update.currentIntervalDays,
        masteryScore: getMasteryScore(update.timesCorrect, update.timesSeen),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Record-attempt endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
