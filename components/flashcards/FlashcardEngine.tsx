'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Question } from '@/types'
import { FlashCard } from './FlashCard'

interface FlashcardEngineProps {
  subtopicId: string
}

type State = 'loading' | 'in_progress' | 'completed'

export function FlashcardEngine({ subtopicId }: FlashcardEngineProps) {
  const [state, setState] = useState<State>('loading')
  const [sessionId, setSessionId] = useState<string>('')
  const [flashcards, setFlashcards] = useState<Question[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  // Stable client + run-once guard (a new client each render re-fired the init
  // effect, inserting a study_session per render).
  const supabase = useMemo(() => createClient(), [])
  const initedRef = useRef(false)

  // Initialize session and fetch flashcards (once).
  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    const initializeFlashcards = async () => {
      try {
        // Create study session
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sessionData, error: sessionError } = await (supabase
          .from('study_sessions') as any)
          .insert([
            {
              subtopic_id: subtopicId,
              session_type: 'flashcard',
            },
          ])
          .select() as any

        if (sessionError) throw sessionError
        if (!sessionData?.[0]) throw new Error('Failed to create session')

        setSessionId(sessionData[0].id)

        // Fetch flashcard questions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: cardsData, error: qError } = await (supabase
          .from('questions')
          .select('*')
          .eq('subtopic_id', subtopicId)
          .eq('question_type', 'flashcard')) as any

        if (qError) throw qError
        if (!cardsData) throw new Error('No flashcards found')

        setFlashcards(cardsData)
        setState('in_progress')
      } catch (err) {
        console.error('Flashcard init error:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize flashcards')
      }
    }

    initializeFlashcards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAnswer = async (isCorrect: boolean) => {
    const currentCard = flashcards[currentIndex]

    try {
      await fetch('/api/record-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          questionId: currentCard.id,
          selectedOptionId: null, // Flashcards don't have options
          isCorrect,
          timeSpentSeconds: 0, // Not tracking time for flashcards
        }),
      })

      setAnswers({
        ...answers,
        [currentCard.id]: isCorrect,
      })

      // Advance to next card
      if (currentIndex < flashcards.length - 1) {
        setCurrentIndex(currentIndex + 1)
      } else {
        // Session complete
        setState('completed')
      }
    } catch (err) {
      console.error('Error recording attempt:', err)
    }
  }

  if (state === 'loading') {
    return <div className="text-center py-8 text-slate-600">Loading flashcards...</div>
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">Error: {error}</div>
  }

  if (state === 'completed') {
    const correctCount = Object.values(answers).filter((a) => a).length

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-5xl font-bold text-green-600 mb-2">{correctCount}</div>
          <div className="text-xl text-slate-600">of {flashcards.length} mastered</div>
          <div className="text-sm text-slate-500 mt-4">
            {flashcards.length - correctCount} to review later
          </div>
        </div>

        <div className="flex gap-3">
          <a
            href={`/exam/${subtopicId}`}
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-center font-medium"
          >
            Back
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
    return <div className="text-center py-8 text-slate-600">No flashcards available for this topic.</div>
  }

  const currentCard = flashcards[currentIndex]

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-slate-700">
            Card {currentIndex + 1} of {flashcards.length}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Flashcard */}
      <FlashCard
        front={currentCard.question_text}
        back={currentCard.justification}
        onGotIt={() => handleAnswer(true)}
        onMissedIt={() => handleAnswer(false)}
      />
    </div>
  )
}
