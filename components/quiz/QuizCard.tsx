'use client'

import { useEffect, useRef, useState } from 'react'
import { Question, QuestionOption } from '@/types'

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

  // Stable ref so the auto-advance timer always calls the latest onContinue
  // without being in the effect dep array (which caused timer-cancel loops).
  const onContinueRef = useRef(onContinue)
  useEffect(() => { onContinueRef.current = onContinue }, [onContinue])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-advance 2s after a correct answer, with visible countdown.
  useEffect(() => {
    if (!answered || !isCorrect) return
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
  }, [answered, isCorrect])

  const handleSelectOption = async (optionId: string) => {
    if (answered || loading) return
    setLoading(true)
    const correctOption = options.find((o) => o.is_correct)
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

  const correctOption = options.find((o) => o.is_correct)

  return (
    <div className="space-y-4">
      {question.source === 'past_exam' && question.past_exam_year && (
        <div className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full border border-blue-300">
          Past Exam {question.past_exam_year}
        </div>
      )}

      {/* Question */}
      <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 leading-snug mb-5">
          {question.question_text}
        </h2>

        {question.image_storage_path && (
          <div className="mb-5 p-4 bg-slate-100 rounded-lg text-center text-slate-500 text-sm">
            [Image: {question.image_storage_path}]
          </div>
        )}

        {/* Options */}
        <div className="space-y-2">
          {options.map((option) => {
            const isSelected = option.id === selectedOptionId
            const isRight = option.id === correctOption?.id

            let cls = 'w-full p-4 text-left border-2 rounded-lg transition-all font-medium '
            if (!answered) {
              cls += 'border-slate-300 bg-white text-slate-800 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
            } else if (isRight) {
              cls += 'border-green-500 bg-green-50 text-green-900 cursor-default'
            } else if (isSelected && !isCorrect) {
              cls += 'border-red-500 bg-red-50 text-red-900 cursor-default'
            } else {
              cls += 'border-slate-200 bg-slate-50 text-slate-500 cursor-default'
            }

            return (
              <button
                key={option.id}
                onClick={() => handleSelectOption(option.id)}
                disabled={answered || loading}
                className={cls}
              >
                <span className="flex items-center gap-3">
                  {answered && isRight && <span className="text-green-600">✓</span>}
                  {answered && isSelected && !isCorrect && <span className="text-red-600">✗</span>}
                  <span>{option.option_text}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Feedback */}
      {answered && (
        <div className={`rounded-xl border p-4 ${isCorrect ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
          {isCorrect ? (
            <div className="flex items-center justify-between">
              <span className="text-green-800 font-semibold">✓ Correct!</span>
              <div className="flex items-center gap-3">
                {countdown !== null && (
                  <span className="text-sm text-green-600">Next in {countdown}s…</span>
                )}
                <button
                  onClick={() => {
                    clearTimeout(timerRef.current!)
                    clearInterval(countdownRef.current!)
                    onContinueRef.current?.()
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
                >
                  Next →
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-red-800 font-semibold">✗ Incorrect</div>
              {question.justification && (
                <div className="bg-white rounded-lg p-3 border border-red-200">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Explanation</p>
                  <p className="text-sm text-slate-800">{question.justification}</p>
                </div>
              )}
              <button
                onClick={onContinue}
                className="w-full mt-1 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium"
              >
                Continue →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Back navigation */}
      {canGoBack && !answered && (
        <button
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          ← Previous question
        </button>
      )}
    </div>
  )
}
