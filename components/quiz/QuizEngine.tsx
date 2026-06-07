'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Question, QuestionOption } from '@/types'
import { QuizCard } from './QuizCard'
import { SessionSummary } from './SessionSummary'

interface QuizEngineProps {
  subtopicId: string
  questionIds: string[]
  topicName: string
}

type State = 'loading' | 'in_progress' | 'completed'

export function QuizEngine({ subtopicId, questionIds, topicName }: QuizEngineProps) {
  const [state, setState] = useState<State>('loading')
  const [sessionId, setSessionId] = useState<string>('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [options, setOptions] = useState<Record<string, QuestionOption[]>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, { isCorrect: boolean; timeSpent: number }>>({})
  const [error, setError] = useState('')
  const supabase = createClient()

  // Initialize session and fetch questions
  useEffect(() => {
    const initializeQuiz = async () => {
      try {
        // Create study session
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sessionData, error: sessionError } = await (supabase
          .from('study_sessions') as any)
          .insert([
            {
              subtopic_id: subtopicId,
              session_type: 'quiz',
            },
          ])
          .select() as any

        if (sessionError) throw sessionError
        if (!sessionData?.[0]) throw new Error('Failed to create session')

        setSessionId(sessionData[0].id)

        // Fetch questions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: questionsData, error: qError } = await (supabase
          .from('questions')
          .select('*')
          .in('id', questionIds)) as any

        if (qError) throw qError
        if (!questionsData) throw new Error('No questions found')

        setQuestions(questionsData)

        // Fetch options for all questions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: optionsData, error: oError } = await (supabase
          .from('question_options')
          .select('*')
          .in(
            'question_id',
            questionsData.map((q: any) => q.id)
          )) as any

        if (oError) throw oError
        if (optionsData) {
          const optionsMap: Record<string, QuestionOption[]> = {}
          optionsData.forEach((opt: any) => {
            if (!optionsMap[opt.question_id]) {
              optionsMap[opt.question_id] = []
            }
            optionsMap[opt.question_id].push(opt)
          })
          setOptions(optionsMap)
        }

        setState('in_progress')
      } catch (err) {
        console.error('Quiz init error:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize quiz')
      }
    }

    initializeQuiz()
  }, [subtopicId, questionIds, supabase])

  const handleAnswer = async (selectedOptionId: string, isCorrect: boolean, timeSpent: number) => {
    const currentQuestion = questions[currentIndex]

    try {
      const response = await fetch('/api/record-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          questionId: currentQuestion.id,
          selectedOptionId,
          isCorrect,
          timeSpentSeconds: timeSpent,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to record attempt')
      }

      setAnswers({
        ...answers,
        [currentQuestion.id]: { isCorrect, timeSpent },
      })
    } catch (err) {
      console.error('Error recording attempt:', err)
    }
  }

  const handleContinue = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      // Quiz complete
      setState('completed')
    }
  }

  if (state === 'loading') {
    return <div className="text-center py-8 text-slate-600">Loading quiz...</div>
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">Error: {error}</div>
  }

  if (state === 'completed') {
    const correctCount = Object.values(answers).filter((a) => a.isCorrect).length
    const totalTime = Object.values(answers).reduce((sum, a) => sum + a.timeSpent, 0)
    const failedQuestions = questions.filter((q) => answers[q.id] && !answers[q.id].isCorrect)

    return (
      <SessionSummary
        total={questions.length}
        correct={correctCount}
        timeSeconds={totalTime}
        failedQuestions={failedQuestions}
        subtopicId={subtopicId}
      />
    )
  }

  if (questions.length === 0) {
    return <div className="text-center py-8 text-slate-600">No questions available.</div>
  }

  const currentQuestion = questions[currentIndex]
  const currentOptions = options[currentQuestion.id] || []

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-slate-700">
            Question {currentIndex + 1} of {questions.length}
          </span>
          <span className="text-sm text-slate-600">{topicName}</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      <QuizCard
        question={currentQuestion}
        options={currentOptions}
        onAnswer={handleAnswer}
        onContinue={handleContinue}
      />
    </div>
  )
}
