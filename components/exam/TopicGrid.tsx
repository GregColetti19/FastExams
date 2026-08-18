import Link from 'next/link'
import { Topic, Subtopic } from '@/types'
import { MasteryBar, button } from '@/components/cadence'
import { masteryLabel } from '@/lib/mastery'

interface TopicWithSubtopics extends Topic {
  subtopics: Subtopic[]
}

export function TopicGrid({
  topics,
  dueInDays,
}: {
  topics: TopicWithSubtopics[]
  /** subtopicId -> days until next due (0 = due today, null = nothing scheduled) */
  dueInDays: Record<string, number | null>
  examId?: string
}) {
  return (
    <div className="space-y-6">
      {topics.map((topic) => (
        <div key={topic.id}>
          <p className="mb-3 font-display text-[16px] text-ink">{topic.name}</p>

          {topic.subtopics && topic.subtopics.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {topic.subtopics.map((subtopic) => (
                <SubtopicCard key={subtopic.id} subtopic={subtopic} dueIn={dueInDays[subtopic.id] ?? null} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No subtopics yet</p>
          )}
        </div>
      ))}
    </div>
  )
}

function SubtopicCard({ subtopic, dueIn }: { subtopic: Subtopic; dueIn: number | null }) {
  const pct = Math.round(subtopic.mastery_score)
  const label = masteryLabel(pct)
  const dueText = dueIn === null ? 'nothing scheduled' : dueIn <= 0 ? 'due today' : `next due in ${dueIn}d`

  return (
    <div className="rounded-card border border-border-hair bg-surface p-4">
      <h3 className="font-display text-ink">{subtopic.name}</h3>
      <p className="mt-0.5 text-xs text-ink-muted">{dueText}</p>

      <div className="mt-3 flex items-center gap-2">
        <MasteryBar pct={pct} className="max-w-[100px]" />
        <span className="text-xs text-ink-secondary tabular-nums">{pct}%</span>
        {label && <span className="text-[11px] text-ink-muted">{label}</span>}
      </div>

      {/* Two launchers — the exception to "no buttons" (§8.3). Coral/teal
          matches the Review mode toggle so the identity is consistent
          wherever a student picks quiz vs flashcard. */}
      <div className="mt-4 flex gap-2">
        <Link
          href={`/quiz/${subtopic.id}`}
          className={button({
            variant: 'ghost',
            size: 'sm',
            className: 'flex-1 border-coral/40 text-coral-soft hover:border-coral',
          })}
        >
          Quiz
        </Link>
        <Link
          href={`/flashcards/${subtopic.id}`}
          className={button({
            variant: 'ghost',
            size: 'sm',
            className: 'flex-1 border-teal-700/40 text-teal-200 hover:border-teal-600',
          })}
        >
          Cards
        </Link>
      </div>
    </div>
  )
}
