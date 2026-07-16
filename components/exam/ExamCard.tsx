'use client'

import Link from 'next/link'
import { Exam } from '@/types'
import { DeleteExamButton } from '@/components/exam/DeleteExamButton'
import { ActiveToggle } from '@/components/exam/ActiveToggle'
import { IconChip, MasteryRing, Pill } from '@/components/cadence'
import { seedAccent } from '@/lib/icons/registry'

export function ExamCard({
  exam,
  mastery,
  dueCount,
}: {
  exam: Exam
  mastery: number
  dueCount: number
}) {
  const accent = seedAccent(exam.id)
  const status =
    mastery >= 100 ? 'mastered' : dueCount > 0 ? 'due' : 'neutral'
  const statusLabel =
    mastery >= 100 ? 'mastered' : dueCount > 0 ? `${dueCount} due today` : 'cool · early'

  return (
    <Link
      href={`/exam/${exam.id}`}
      className="block rounded-card border border-border-hair bg-surface p-4 transition-all duration-150 motion-safe:hover:-translate-y-px hover:border-border-strong"
    >
      <div className="mb-3 flex items-start justify-between">
        <IconChip name={null} accent={accent} />
        <Pill variant={status as 'due' | 'neutral' | 'mastered'}>{statusLabel}</Pill>
      </div>

      <h3 className="font-display text-ink">{exam.name}</h3>
      {exam.description && (
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{exam.description}</p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MasteryRing pct={mastery} size={36} />
          <span className="text-sm text-ink-secondary tabular-nums">{mastery}% mastery</span>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
          <ActiveToggle examId={exam.id} active={exam.active !== false} />
          <DeleteExamButton examId={exam.id} examName={exam.name} />
        </div>
      </div>
    </Link>
  )
}
