import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { review, binaryGrade, State, type StoredCard } from '@/lib/fsrs'
import { masteryFromCard } from '@/lib/mastery'

export async function POST(request: NextRequest) {
  try {
    const { sessionId, questionId, selectedOptionId, isCorrect, timeSpentSeconds } = await request.json()

    if (!questionId || isCorrect === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields', code: 'MISSING_FIELDS' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient_()

    // Insert attempt only when a valid session exists (session creation is
    // best-effort in dev; question scheduling below always runs regardless).
    if (sessionId) {
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
        console.error('Failed to insert attempt (non-fatal):', attemptError)
      }
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

    // FSRS scheduling — rehydrate the persisted card, apply the grade, persist the result.
    const priorCard: StoredCard = {
      due: new Date(question.next_review_at),
      stability: question.stability ?? 0,
      difficulty: question.difficulty ?? 0,
      reps: question.reps ?? 0,
      lapses: question.lapses ?? 0,
      state: (question.fsrs_state ?? State.New) as State,
      learning_steps: question.learning_steps ?? 0,
      last_review: question.last_seen_at ? new Date(question.last_seen_at) : null,
    }
    const grade = binaryGrade(isCorrect)
    const nextCard = review(priorCard, grade)

    // Update question scheduling (both FSRS state and the legacy SM-2 counters,
    // which other pages/queries still read from until the routing pass migrates them).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('questions') as any)
      .update({
        times_seen: question.times_seen + 1,
        times_correct: isCorrect ? question.times_correct + 1 : question.times_correct,
        last_seen_at: new Date().toISOString(),
        next_review_at: nextCard.due.toISOString(),
        stability: nextCard.stability,
        difficulty: nextCard.difficulty,
        reps: nextCard.reps,
        lapses: nextCard.lapses,
        fsrs_state: nextCard.state,
        learning_steps: nextCard.learning_steps,
      })
      .eq('id', questionId)

    // Update session stats if session exists.
    if (sessionId) {
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
    }

    // Recalculate subtopic mastery across ALL its questions (not just this one),
    // averaging each question's FSRS-stability-derived mastery.
    let masteryScore = masteryFromCard(nextCard)
    if (question.subtopic_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: subtopicQuestions } = await (supabase.from('questions') as any)
        .select('id, stability, fsrs_state')
        .eq('subtopic_id', question.subtopic_id) as any

      if (subtopicQuestions && subtopicQuestions.length > 0) {
        const scores = subtopicQuestions.map((q: any) =>
          q.id === questionId
            ? masteryFromCard(nextCard)
            : masteryFromCard({ stability: q.stability ?? 0, state: q.fsrs_state ?? State.New })
        )
        masteryScore = Math.round(scores.reduce((s: number, v: number) => s + v, 0) / scores.length)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('subtopics') as any)
          .update({ mastery_score: masteryScore })
          .eq('id', question.subtopic_id)
      }
    }

    return NextResponse.json(
      {
        success: true,
        nextReviewAt: nextCard.due,
        stability: nextCard.stability,
        masteryScore,
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
