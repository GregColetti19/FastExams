'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Question, QuestionOption } from '@/types'
import { advanceQueue, isSessionComplete, QueueState } from '@/lib/scheduling/session-queue'
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
  // Queue-driven so wrong answers can be reproposed within the session.
  const [queueState, setQueueState] = useState<QueueState>({ queue: [], requeued: {} })
  const [lastCorrect, setLastCorrect] = useState(false)
  const [step, setStep] = useState(0) // forces QuizCard remount when a question reappears
  const [answers, setAnswers] = useState<Record<string, { isCorrect: boolean; timeSpent: number }>>({})
  // History of queue snapshots for back-navigation (pre-advance state).
  const [history, setHistory] = useState<QueueState[]>([])
  const [error, setError] = useState('')
  // Stable client + run-once guard: a fresh createClient() each render made the
  // init effect re-fire on every render, inserting a study_session each time.
  const supabase = useMemo(() => createClient(), [])
  const initedRef = useRef(false)

  // Initialize session and fetch questions (once).
  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    const initializeQuiz = async () => {
      try {
        // Fire session creation and question fetches in parallel.
        // Session insert is best-effort — the quiz still runs if it fails, so a
        // missing session only costs attempt attribution, not the study run.
        const sessionPromise = supabase.auth
          .getUser()
          .then(({ data: { user } }: any) => {
            if (!user) {
              console.warn('No session user — study_sessions insert skipped')
              return
            }
            return (supabase.from('study_sessions') as any)
              .insert([{ subtopic_id: subtopicId, session_type: 'quiz', user_id: user.id }])
              .select()
              .then(({ data, error }: any) => {
                if (error) console.warn('study_sessions insert failed (non-fatal):', error.message)
                else setSessionId(data?.[0]?.id ?? '')
              })
          })
          .catch((e: any) => console.warn('study_sessions error (non-fatal):', e))

        const [{ data: questionsData, error: qError }, { data: optionsData }] =
          await Promise.all([
            (supabase.from('questions').select('*').in('id', questionIds)) as any,
            (supabase.from('question_options').select('*').in('question_id', questionIds)) as any,
          ])

        // Let session finish in background — don't block quiz start
        sessionPromise.catch(() => {})

        if (qError) throw new Error(`Questions fetch failed: ${qError.message}`)
        if (!questionsData?.length) throw new Error('No questions found for this subtopic')

        setQuestions(questionsData)
        setQueueState({ queue: questionsData.map((q: any) => q.id), requeued: {} })

        if (optionsData) {
          const optionsMap: Record<string, QuestionOption[]> = {}
          optionsData.forEach((opt: any) => {
            if (!optionsMap[opt.question_id]) optionsMap[opt.question_id] = []
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

    initializeQuiz().catch((err) => {
      console.error('Quiz init unhandled rejection:', err)
      setError(err instanceof Error ? err.message : String(err))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAnswer = async (selectedOptionId: string, isCorrect: boolean, timeSpent: number) => {
    const currentId = queueState.queue[0]
    setLastCorrect(isCorrect)

    // Local state is source of truth for UI — update regardless of API success.
    // A reproposed question overwrites the previous (wrong) answer if now correct.
    setAnswers((prev) => ({ ...prev, [currentId]: { isCorrect, timeSpent } }))

    // Persist to server best-effort (scheduling + mastery update).
    fetch('/api/record-attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId || null,
        questionId: currentId,
        selectedOptionId,
        isCorrect,
        timeSpentSeconds: timeSpent,
      }),
    }).catch((err) => console.error('Error recording attempt:', err))
  }

  const handleContinue = () => {
    const next = advanceQueue(queueState, lastCorrect)
    setHistory((h) => [...h, queueState])
    if (isSessionComplete(next)) {
      setState('completed')
    } else {
      setQueueState(next)
      setStep((s) => s + 1)
    }
  }

  const handleBack = () => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setQueueState(prev)
    setStep((s) => s + 1)
  }

  if (state === 'loading') {
    return <div className="py-8 text-center text-ink-muted">Loading quiz…</div>
  }

  if (error) {
    return <div className="py-8 text-center text-coral">Error: {error}</div>
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
    return <div className="py-8 text-center text-ink-muted">No questions available.</div>
  }

  const currentId = queueState.queue[0]
  const currentQuestion = questions.find((q) => q.id === currentId)
  if (!currentQuestion) {
    return <div className="py-8 text-center text-ink-muted">No questions available.</div>
  }
  const currentOptions = options[currentQuestion.id] || []

  const total = questions.length
  const remaining = new Set(queueState.queue).size
  const resolved = total - remaining
  const isRepropose = (queueState.requeued[currentId] ?? 0) > 0

  return (
    <div className="space-y-6">
      {/* Progress — coral while an active session is in flight */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-ink-secondary tabular-nums">
            Question {resolved + 1} of {total}
            {isRepropose && <span className="ml-2 text-coral-soft">↻ retry</span>}
          </span>
          <span className="text-sm text-ink-muted">{topicName}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset">
          <div
            className="h-full rounded-pill bg-coral motion-safe:transition-[width] motion-safe:duration-tempo"
            style={{ width: `${(resolved / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Question Card — keyed so a reproposed question remounts fresh */}
      <QuizCard
        key={`${currentQuestion.id}-${step}`}
        question={currentQuestion}
        options={currentOptions}
        onAnswer={handleAnswer}
        onContinue={handleContinue}
        onBack={handleBack}
        canGoBack={history.length > 0}
      />
    </div>
  )
}
