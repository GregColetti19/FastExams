'use client'

import Link from 'next/link'
import { Topic, Subtopic } from '@/types'

interface TopicWithSubtopics extends Topic {
  subtopics: Subtopic[]
}

export function TopicGrid({
  topics,
}: {
  topics: TopicWithSubtopics[]
  examId?: string
}) {
  return (
    <div className="space-y-6">
      {topics.map((topic) => (
        <div key={topic.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">{topic.name}</h2>

          {topic.subtopics && topic.subtopics.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {topic.subtopics.map((subtopic) => (
                <SubtopicCard key={subtopic.id} subtopic={subtopic} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No subtopics yet</p>
          )}
        </div>
      ))}
    </div>
  )
}

function SubtopicCard({ subtopic }: { subtopic: Subtopic }) {
  const getMasteryColor = (score: number) => {
    if (score >= 80) return 'bg-green-50 border-green-300'
    if (score >= 50) return 'bg-yellow-50 border-yellow-300'
    return 'bg-red-50 border-red-300'
  }

  const getMasteryTextColor = (score: number) => {
    if (score >= 80) return 'text-green-900'
    if (score >= 50) return 'text-yellow-900'
    return 'text-red-900'
  }

  return (
    <div
      className={`rounded-lg border-2 p-4 ${getMasteryColor(
        subtopic.mastery_score
      )}`}
    >
      <h3 className="font-medium text-slate-900">{subtopic.name}</h3>

      <div className="mt-3 flex items-center justify-between">
        <span className={`text-sm font-medium ${getMasteryTextColor(subtopic.mastery_score)}`}>
          {Math.round(subtopic.mastery_score)}% mastery
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href={`/quiz/${subtopic.id}`}
          className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 text-center"
        >
          Quiz
        </Link>
        <Link
          href={`/flashcards/${subtopic.id}`}
          className="flex-1 px-3 py-2 bg-slate-200 text-slate-900 text-sm rounded hover:bg-slate-300 text-center"
        >
          Flashcards
        </Link>
      </div>
    </div>
  )
}
