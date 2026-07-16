'use client'

import Link from 'next/link'
import { masteryColor } from '@/lib/mastery'

interface SessionSummaryProps {
  total: number
  correct: number
  timeSeconds: number
  failedQuestions: { id: string; question_text: string }[]
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
  const color = masteryColor(percentage, 'dark')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Score */}
      <div className="rounded-card border border-border-hair bg-surface p-8 text-center">
        <div className="font-display text-[48px] leading-none tabular-nums" style={{ color }}>
          {percentage}%
        </div>
        <div className="mt-2 text-lg text-ink-secondary">
          {correct} of {total} correct
        </div>
        <div className="mt-1 text-sm text-ink-muted tabular-nums">
          {minutes}m {seconds}s
        </div>
      </div>

      {/* Missed questions — informative, not punishing */}
      {failedQuestions.length > 0 && (
        <div className="rounded-card border border-border-hair bg-surface p-6">
          <h3 className="mb-4 font-display text-ink">
            Worth another look ({failedQuestions.length})
          </h3>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {failedQuestions.map((q) => (
              <div key={q.id} className="rounded-control bg-surface-inset p-3">
                <p className="text-sm text-ink-secondary">{q.question_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions — recap closes the loop back to Review */}
      <div className="flex gap-3">
        <Link
          href={`/flashcards/${subtopicId}`}
          className="flex-1 rounded-control border border-border-hair py-3 text-center text-sm text-ink-secondary transition-colors duration-150 hover:border-border-strong"
        >
          Flashcards
        </Link>
        <Link
          href="/review"
          className="flex-1 rounded-control bg-coral py-3 text-center font-display text-white transition-colors duration-tempo hover:bg-coral-deep"
        >
          Back to Review
        </Link>
      </div>
    </div>
  )
}
