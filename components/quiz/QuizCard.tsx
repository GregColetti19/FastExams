'use client'

import { useEffect, useState } from 'react'
import { Question, QuestionOption } from '@/types'

interface QuizCardProps {
  question: Question
  options: QuestionOption[]
  onAnswer: (selectedOptionId: string, isCorrect: boolean, timeSpent: number) => Promise<void>
  onContinue?: () => void
}

export function QuizCard({ question, options, onAnswer, onContinue }: QuizCardProps) {
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const [loading, setLoading] = useState(false)
  const [startTime] = useState(Date.now())
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState<NodeJS.Timeout | null>(null)

  // Auto-advance on correct answer
  useEffect(() => {
    if (answered && isCorrect && !autoAdvanceTimer) {
      const timer = setTimeout(() => {
        onContinue?.()
      }, 1500)
      setAutoAdvanceTimer(timer)
    }

    return () => {
      if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer)
    }
  }, [answered, isCorrect, onContinue, autoAdvanceTimer])

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
    <div className="space-y-6">
      {/* Question */}
      {question.source === 'past_exam' && question.past_exam_year && (
        <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs rounded">
          📋 Past Exam {question.past_exam_year}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">{question.question_text}</h2>

        {question.image_storage_path && (
          <div className="mb-6 p-4 bg-slate-100 rounded-lg text-center text-slate-500">
            [Image: {question.image_storage_path}]
          </div>
        )}

        {/* Options */}
        <div className="space-y-3">
          {options.map((option) => {
            let bgColor = 'bg-white border-slate-200 hover:bg-slate-50'
            let textColor = 'text-slate-900'

            if (answered) {
              if (option.id === correctOption?.id) {
                bgColor = 'bg-green-50 border-green-500'
                textColor = 'text-green-900'
              } else if (option.id === selectedOptionId && !isCorrect) {
                bgColor = 'bg-red-50 border-red-500'
                textColor = 'text-red-900'
              } else {
                bgColor = 'bg-slate-50 border-slate-300'
                textColor = 'text-slate-600'
              }
            }

            return (
              <button
                key={option.id}
                onClick={() => handleSelectOption(option.id)}
                disabled={answered || loading}
                className={`w-full p-4 text-left border-2 rounded-lg transition-colors ${bgColor} ${textColor} disabled:cursor-not-allowed`}
              >
                <div className="font-medium">{option.option_text}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Feedback */}
      {answered && (
        <div className={`rounded-lg p-4 ${isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
          {isCorrect ? (
            <div className="text-green-900 font-medium">✓ Correct!</div>
          ) : (
            <div className="space-y-3">
              <div className="text-red-900 font-medium">✗ Incorrect</div>
              <div className="bg-white rounded p-3 mt-2">
                <p className="text-sm font-medium text-slate-900 mb-2">Explanation:</p>
                <p className="text-sm text-slate-700">{question.justification}</p>
              </div>
              {!isCorrect && onContinue && (
                <button
                  onClick={onContinue}
                  className="w-full mt-3 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800"
                >
                  Continue
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
