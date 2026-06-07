'use client'

import { useState } from 'react'

interface FlagButtonProps {
  questionId: string
  subtopics: Array<{ id: string; name: string }>
  onFlag: (action: 'reassign' | 'poor_quality', subtopicId?: string) => Promise<void>
}

export function FlagButton({ questionId, subtopics, onFlag }: FlagButtonProps) {
  const [open, setOpen] = useState(false)
  const [selectedSubtopic, setSelectedSubtopic] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleReassign = async () => {
    if (!selectedSubtopic) return
    setLoading(true)
    try {
      await onFlag('reassign', selectedSubtopic)
      setOpen(false)
      setSelectedSubtopic(null)
    } finally {
      setLoading(false)
    }
  }

  const handlePoorQuality = async () => {
    setLoading(true)
    try {
      await onFlag('poor_quality')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        title="Flag this question"
      >
        ⚑
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 p-4 z-10">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Reassign subtopic
              </label>
              <select
                value={selectedSubtopic || ''}
                onChange={(e) => setSelectedSubtopic(e.target.value || null)}
                disabled={loading}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select subtopic...</option>
                {subtopics.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleReassign}
                disabled={!selectedSubtopic || loading}
                className="w-full mt-2 px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
              >
                Reassign
              </button>
            </div>

            <button
              onClick={handlePoorQuality}
              disabled={loading}
              className="w-full px-3 py-2 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
            >
              Mark poor quality
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
