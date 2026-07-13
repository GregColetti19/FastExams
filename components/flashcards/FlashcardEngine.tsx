'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Question } from '@/types'
import { FlashCard } from './FlashCard'

interface FlashcardEngineProps {
  subtopicId: string
  examId: string
}

type State = 'loading' | 'in_progress' | 'completed'

// Matches the hardcoded dev user in /api/upload and QuizEngine.
const MOCK_USER_ID = '6a7223fc-a96d-434a-9125-98ba6e4daca3'

export function FlashcardEngine({ subtopicId, examId }: FlashcardEngineProps) {
  const [state, setState] = useState<State>('loading')
  const [sessionId, setSessionId] = useState<string>('')
  const [flashcards, setFlashcards] = useState<Question[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const supabase = useMemo(() => createClient(), [])
  const initedRef = useRef(false)

  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true

    const init = async () => {
      try {
        // Session creation best-effort — cards work even if this fails.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sessionData } = await (supabase.from('study_sessions') as any)
          .insert([{ subtopic_id: subtopicId, session_type: 'flashcard', user_id: MOCK_USER_ID }])
          .select() as any
        if (sessionData?.[0]?.id) setSessionId(sessionData[0].id)

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

  const handleAnswer = (isCorrect: boolean) => {
    const currentCard = flashcards[currentIndex]

    // Update local state immediately — don't wait on the API.
    setAnswers((prev) => ({ ...prev, [currentCard.id]: isCorrect }))

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
        isCorrect,
        timeSpentSeconds: null,
      }),
    }).catch((err) => console.error('record-attempt failed (non-fatal):', err))
  }

  if (state === 'loading') {
    return <div className="text-center py-8 text-slate-600">Loading flashcards...</div>
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">Error: {error}</div>
  }

  if (state === 'completed') {
    const correctCount = Object.values(answers).filter(Boolean).length
    const total = flashcards.length

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-5xl font-bold text-green-600 mb-2">{correctCount}/{total}</div>
          <div className="text-xl text-slate-600">
            {Math.round((correctCount / total) * 100)}% mastered
          </div>
          {total - correctCount > 0 && (
            <div className="text-sm text-slate-500 mt-2">
              {total - correctCount} card{total - correctCount !== 1 ? 's' : ''} to review again
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <a
            href={examId ? `/exam/${examId}` : '/dashboard'}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-center font-medium"
          >
            Back to Exam
          </a>
          <a
            href="/dashboard"
            className="flex-1 px-4 py-3 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 text-center font-medium"
          >
            Dashboard
          </a>
        </div>
      </div>
    )
  }

  if (flashcards.length === 0) {
    return <div className="text-center py-8 text-slate-600">No flashcards available for this subtopic.</div>
  }

  const currentCard = flashcards[currentIndex]
  // Progress = cards answered, not cards seen. Starts at 0, ends at total.
  const answeredCount = Object.keys(answers).length

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-slate-700">
            {answeredCount} of {flashcards.length} answered
          </span>
          <span className="text-sm text-slate-500">
            Card {currentIndex + 1} / {flashcards.length}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${(answeredCount / flashcards.length) * 100}%` }}
          />
        </div>
      </div>

      <FlashCard
        key={currentCard.id}
        front={currentCard.question_text}
        back={currentCard.justification}
        onGotIt={() => handleAnswer(true)}
        onMissedIt={() => handleAnswer(false)}
      />
    </div>
  )
}
