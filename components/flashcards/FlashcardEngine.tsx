'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Question } from '@/types'
import { Rating, type Grade } from '@/lib/fsrs'
import { FlashCard } from './FlashCard'

interface FlashcardEngineProps {
  subtopicId: string
  examId: string
}

type State = 'loading' | 'in_progress' | 'completed'

export function FlashcardEngine({ subtopicId, examId }: FlashcardEngineProps) {
  const [state, setState] = useState<State>('loading')
  const [sessionId, setSessionId] = useState<string>('')
  const [flashcards, setFlashcards] = useState<Question[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Grade>>({})
  const [error, setError] = useState('')
  const supabase = useMemo(() => createClient(), [])
  const initedRef = useRef(false)

  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true

    const init = async () => {
      try {
        // Session creation best-effort — cards work even if this fails.
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: sessionData } = await (supabase.from('study_sessions') as any)
            .insert([{ subtopic_id: subtopicId, session_type: 'flashcard', user_id: user.id }])
            .select() as any
          if (sessionData?.[0]?.id) setSessionId(sessionData[0].id)
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: cards, error: qError } = await (supabase
          .from('questions')
          .select('*')
          .eq('subtopic_id', subtopicId)
          .eq('question_type', 'flashcard')) as any

        if (qError) throw qError
        if (!cards?.length) throw new Error('No flashcards found for this subtopic.')

        setFlashcards(cards)
        setState('in_progress')
      } catch (err) {
        console.error('Flashcard init error:', err)
        setError(err instanceof Error ? err.message : 'Failed to load flashcards')
      }
    }

    init().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRate = (grade: Grade) => {
    const currentCard = flashcards[currentIndex]

    // Update local state immediately — don't wait on the API.
    setAnswers((prev) => ({ ...prev, [currentCard.id]: grade }))

    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex((i) => i + 1)
    } else {
      setState('completed')
    }

    // Persist best-effort.
    fetch('/api/record-attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId || null,
        questionId: currentCard.id,
        selectedOptionId: null,
        grade,
        timeSpentSeconds: null,
      }),
    }).catch((err) => console.error('record-attempt failed (non-fatal):', err))
  }

  if (state === 'loading') {
    return <div className="py-8 text-center text-ink-muted">Loading flashcards…</div>
  }

  if (error) {
    return <div className="py-8 text-center text-coral">Error: {error}</div>
  }

  if (state === 'completed') {
    const correctCount = Object.values(answers).filter((g) => g !== Rating.Again).length
    const total = flashcards.length
    const pct = Math.round((correctCount / total) * 100)

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-card border border-border-hair bg-surface p-8 text-center">
          <div className="font-display text-[48px] leading-none tabular-nums text-teal-100">
            {correctCount}/{total}
          </div>
          <div className="mt-2 text-lg text-ink-secondary tabular-nums">{pct}% mastered</div>
          {total - correctCount > 0 && (
            <div className="mt-2 text-sm text-ink-muted">
              {total - correctCount} card{total - correctCount !== 1 ? 's' : ''} to review again
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <a
            href={examId ? `/exam/${examId}` : '/dashboard'}
            className="flex-1 rounded-control border border-border-hair py-3 text-center text-sm text-ink-secondary transition-colors duration-150 hover:border-border-strong"
          >
            Back to exam
          </a>
          <a
            href="/review"
            className="flex-1 rounded-control bg-coral py-3 text-center font-display text-white transition-colors duration-tempo hover:bg-coral-deep"
          >
            Back to Review
          </a>
        </div>
      </div>
    )
  }

  if (flashcards.length === 0) {
    return <div className="py-8 text-center text-ink-muted">No flashcards available for this subtopic.</div>
  }

  const currentCard = flashcards[currentIndex]
  // Progress = cards answered, not cards seen. Starts at 0, ends at total.
  const answeredCount = Object.keys(answers).length

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-ink-secondary tabular-nums">
            {answeredCount} of {flashcards.length} answered
          </span>
          <span className="text-sm text-ink-muted tabular-nums">
            Card {currentIndex + 1} / {flashcards.length}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset">
          <div
            className="h-full rounded-pill bg-teal-400 motion-safe:transition-[width] motion-safe:duration-tempo"
            style={{ width: `${(answeredCount / flashcards.length) * 100}%` }}
          />
        </div>
      </div>

      <FlashCard
        key={currentCard.id}
        front={currentCard.question_text}
        back={currentCard.justification}
        onRate={handleRate}
      />
    </div>
  )
}
