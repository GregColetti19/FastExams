'use client'

import { useMemo, useState } from 'react'
import { FilterChip, MasteryBar } from '@/components/cadence'
import { masteryColor } from '@/lib/mastery'
import { useTheme } from '@/components/cadence/ThemeProvider'
import { buildAnalytics } from '@/lib/analytics/stats'
import type { Exam, Topic, Subtopic, Question, QuestionAttempt } from '@/types'

interface Props {
  exams: Exam[]
  topics: Topic[]
  subtopics: Subtopic[]
  questions: Question[]
  attempts: QuestionAttempt[]
}

export function AnalyticsView({ exams, topics, subtopics, questions, attempts }: Props) {
  const [included, setIncluded] = useState(() => new Set(exams.map((e) => e.id)))
  const mode = useTheme()

  const data = useMemo(
    () => buildAnalytics(exams, topics, subtopics, questions, attempts, included),
    [exams, topics, subtopics, questions, attempts, included]
  )

  const toggle = (examId: string) => {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(examId)) next.delete(examId)
      else next.add(examId)
      return next
    })
  }

  const maxCards = Math.max(1, ...data.decks.map((d) => d.cardCount))

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-[22px] tracking-[-0.01em] text-ink">Performance</h1>
        <p className="text-sm text-ink-muted">Across all your exams · last 8 weeks</p>
      </div>

      {/* Filter chips — tap to include/exclude from the visuals */}
      <div className="mb-6 flex flex-wrap gap-2">
        {exams.map((exam) => (
          <FilterChip
            key={exam.id}
            label={exam.name}
            active={included.has(exam.id)}
            onToggle={() => toggle(exam.id)}
          />
        ))}
      </div>

      {/* Metric cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Overall mastery" value={`${data.overallMastery}%`} tabular />
        <Metric label="Decks tracked" value={String(data.decksTracked)} tabular />
        <Metric label="Cards in rotation" value={String(data.cardsInRotation)} tabular />
        <Metric label="Reviews this week" value={String(data.reviewsThisWeek)} tabular />
      </div>

      {/* Mastery by deck */}
      <div className="mb-6 rounded-card border border-border-hair bg-surface p-5">
        <p className="mb-4 text-sm text-ink-secondary">Mastery by deck</p>
        {data.decks.length === 0 ? (
          <p className="text-sm text-ink-muted">No exams selected.</p>
        ) : (
          <div className="space-y-3">
            {data.decks.map((d) => (
              <div key={d.examId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-ink-secondary" title={d.examName}>
                  {d.examName}
                </span>
                <div className="flex-1">
                  <MasteryBar pct={d.mastery} />
                </div>
                <span className="w-10 shrink-0 text-right text-xs text-ink-muted tabular-nums">
                  {d.mastery}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cards per deck — simple hand-rolled horizontal bars, no chart lib */}
      <div className="rounded-card border border-border-hair bg-surface p-5">
        <p className="mb-4 text-sm text-ink-secondary">Cards in rotation by deck</p>
        {data.decks.length === 0 ? (
          <p className="text-sm text-ink-muted">No exams selected.</p>
        ) : (
          <div className="space-y-2">
            {data.decks.map((d) => (
              <div key={d.examId} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-ink-secondary" title={d.examName}>
                  {d.examName}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-inset">
                  <div
                    className="h-full rounded-pill motion-safe:transition-[width] motion-safe:duration-tempo"
                    style={{
                      width: `${(d.cardCount / maxCards) * 100}%`,
                      background: masteryColor(d.mastery, mode),
                    }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs text-ink-muted tabular-nums">
                  {d.cardCount}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, tabular }: { label: string; value: string; tabular?: boolean }) {
  return (
    <div className="rounded-card border border-border-hair bg-surface p-4">
      <p className={`font-display text-[22px] text-ink ${tabular ? 'tabular-nums' : ''}`}>{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{label}</p>
    </div>
  )
}
