'use client'

import Link from 'next/link'
import { Question } from '@/types'

interface SessionSummaryProps {
  total: number
  correct: number
  timeSeconds: number
  failedQuestions: Question[]
  subtopicId: string
}

export function SessionSummary({
  total,
  correct,
  timeSeconds,
  failedQuestions,
  subtopicId,
}: SessionSummaryProps) {
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0
  const minutes = Math.floor(timeSeconds / 60)
  const seconds = timeSeconds % 60

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Score Card */}
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="text-6xl font-bold text-blue-600 mb-2">{percentage}%</div>
        <div className="text-xl text-slate-600 mb-4">
          {correct} of {total} correct
        </div>
        <div className="text-sm text-slate-500">
          Time: {minutes}m {seconds}s
        </div>
      </div>

      {/* Failed Questions */}
      {failedQuestions.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            Questions to Review ({failedQuestions.length})
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {failedQuestions.map((q) => (
              <div key={q.id} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-900 font-medium">{q.question_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Link
          href={`/flashcards/${subtopicId}`}
          className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-center font-medium"
        >
          Flashcards
        </Link>
        <Link
          href="/dashboard"
          className="flex-1 px-4 py-3 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 text-center font-medium"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
