'use client'

import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconX, IconAlertTriangle } from '@tabler/icons-react'
import { Question, QuestionOption } from '@/types'
import { Button } from '@/components/cadence/Button'
import { OriginBadge } from '@/components/cadence/OriginBadge'
import { cn } from '@/lib/utils'

interface QuizCardProps {
  question: Question
  options: QuestionOption[]
  onAnswer: (selectedOptionId: string, isCorrect: boolean, timeSpent: number) => Promise<void>
  onContinue?: () => void
  onBack?: () => void
  canGoBack?: boolean
}

export function QuizCard({ question, options, onAnswer, onContinue, onBack, canGoBack }: QuizCardProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const [loading, setLoading] = useState(false)
  const [startTime] = useState(Date.now())
  const [countdown, setCountdown] = useState<number | null>(null)
  const [overriding, setOverriding] = useState(false)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [localOptions, setLocalOptions] = useState(options)

  useEffect(() => {
    setLocalOptions(options)
    setOverriding(false)
  }, [options])

  const handleOverride = async (correctOptionId: string) => {
    setOverrideSaving(true)
    try {
      await fetch('/api/override-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, correctOptionId }),
      })
      setLocalOptions((prev) => prev.map((o) => ({ ...o, is_correct: o.id === correctOptionId })))
      setOverriding(false)
    } catch (error) {
      console.error('Error overriding answer:', error)
    } finally {
      setOverrideSaving(false)
    }
  }

  // Stable ref so the auto-advance timer always calls the latest onContinue
  // without being in the effect dep array (which caused timer-cancel loops).
  const onContinueRef = useRef(onContinue)
  useEffect(() => { onContinueRef.current = onContinue }, [onContinue])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-advance 2s after a correct answer, with visible countdown.
  // Skipped/cancelled while the answer-override picker is open — the user
  // opened it to correct the answer, not to move on.
  useEffect(() => {
    if (!answered || !isCorrect || overriding) return
    setCountdown(2)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(countdownRef.current!)
          return null
        }
        return c - 1
      })
    }, 1000)
    timerRef.current = setTimeout(() => {
      onContinueRef.current?.()
    }, 2000)
    return () => {
      clearTimeout(timerRef.current!)
      clearInterval(countdownRef.current!)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, isCorrect, overriding])

  const handleSelectOption = async (optionId: string) => {
    if (answered || loading) return
    setLoading(true)
    const correctOption = localOptions.find((o) => o.is_correct)
    const correct = optionId === correctOption?.id
    setSelectedOptionId(optionId)
    setIsCorrect(correct)
    setAnswered(true)
    try {
      const timeSpent = Math.round((Date.now() - startTime) / 1000)
      await onAnswer(optionId, correct, timeSpent)
    } catch (error) {
      console.error('Error recording answer:', error)
    } finally {
      setLoading(false)
    }
  }

  const correctOption = localOptions.find((o) => o.is_correct)
  const isPastExam = question.source === 'past_exam'
  const isAiAnswered = isPastExam && question.answer_status === 'ai_answered' && question.ai_confidence != null
  const isUnanswerable = isPastExam && question.answer_status === 'unanswerable'
  const lowConfidence = isAiAnswered && (question.ai_confidence as number) < 0.6

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <OriginBadge
          origin={isPastExam ? 'pastExam' : 'ai'}
          year={question.past_exam_year ?? undefined}
          lowConfidence={lowConfidence}
        />
        {isAiAnswered && (
          <span className="text-xs text-ink-muted">
            {Math.round((question.ai_confidence as number) * 100)}% confidence
          </span>
        )}
        {isUnanswerable && (
          <span className="inline-flex items-center gap-1 rounded-pill bg-coral/15 px-2.5 py-0.5 text-xs text-coral-soft">
            <IconAlertTriangle size={12} stroke={2} /> unverified — needs review
          </span>
        )}
        {question.answer_status === 'user_set' && (
          <span className="text-xs text-ink-muted">user-corrected</span>
        )}
      </div>

      {/* Question */}
      <div className="rounded-card border border-border-hair bg-surface p-6">
        <h2 className="font-display text-[17px] leading-[1.5] text-ink mb-5">
          {question.question_text}
        </h2>

        {question.image_storage_path && (
          <div className="mb-5 rounded-control bg-surface-inset p-4 text-center text-sm text-ink-muted">
            [Image: {question.image_storage_path}]
          </div>
        )}

        {/* Options */}
        <div className="space-y-2">
          {localOptions.map((option) => {
            const isSelected = option.id === selectedOptionId
            const isRight = option.id === correctOption?.id

            return (
              <button
                key={option.id}
                onClick={() => handleSelectOption(option.id)}
                disabled={answered || loading}
                className={cn(
                  'w-full rounded-control border p-4 text-left text-[15px] transition-colors duration-150',
                  !answered && 'border-border-hair bg-surface text-ink hover:border-border-strong cursor-pointer',
                  answered && isRight && 'border-teal-700 bg-teal-800/10 text-ink cursor-default',
                  answered && isSelected && !isCorrect && 'border-border-strong bg-surface-inset text-ink-secondary cursor-default',
                  answered && !isRight && !isSelected && 'border-border-hair bg-surface text-ink-muted cursor-default'
                )}
              >
                <span className="flex items-center gap-3">
                  {answered && isRight && <IconCheck size={16} className="text-teal-200 shrink-0" />}
                  {answered && isSelected && !isCorrect && <IconX size={16} className="text-ink-muted shrink-0" />}
                  <span>{option.option_text}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Feedback */}
      {answered && (
        <div
          className={cn(
            'rounded-card border p-4',
            isCorrect ? 'border-teal-700/40 bg-teal-800/10' : 'border-border-hair bg-surface-inset'
          )}
        >
          {isCorrect ? (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-display text-teal-100">
                <IconCheck size={16} /> Correct
              </span>
              <div className="flex items-center gap-3">
                {countdown !== null && (
                  <span className="text-sm text-ink-muted tabular-nums">Next in {countdown}s…</span>
                )}
                <Button
                  variant="confirm"
                  size="sm"
                  onClick={() => {
                    clearTimeout(timerRef.current!)
                    clearInterval(countdownRef.current!)
                    onContinueRef.current?.()
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="font-display text-ink-secondary">Not quite</div>
              {question.justification && (
                <div className="rounded-control border border-border-hair bg-surface p-3">
                  <p className="mb-1 text-[11px] text-ink-muted">explanation</p>
                  <p className="text-sm text-ink-secondary">{question.justification}</p>
                </div>
              )}
              <Button variant="primary" className="w-full" onClick={onContinue}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Answer override — past-exam answers are AI-inferred, let the user correct them */}
      {answered && isPastExam && question.answer_status !== 'user_set' && (
        <div className="text-sm">
          {!overriding ? (
            <button
              onClick={() => setOverriding(true)}
              className="text-ink-muted hover:text-ink-secondary underline"
            >
              Think this answer is wrong? Correct it
            </button>
          ) : (
            <div className="rounded-control border border-border-hair bg-surface-inset p-3 space-y-2">
              <p className="text-xs text-ink-secondary">Select the correct option:</p>
              <div className="flex flex-wrap gap-2">
                {localOptions.map((option) => (
                  <button
                    key={option.id}
                    disabled={overrideSaving}
                    onClick={() => handleOverride(option.id)}
                    className="rounded-control border border-border-hair bg-surface px-3 py-1.5 text-sm text-ink hover:border-border-strong disabled:opacity-50"
                  >
                    {option.option_text}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setOverriding(false)}
                className="text-xs text-ink-muted hover:text-ink-secondary"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Back navigation */}
      {canGoBack && !answered && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink-secondary"
        >
          ← Previous question
        </button>
      )}
    </div>
  )
}
