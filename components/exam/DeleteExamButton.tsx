'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

export function DeleteExamButton({
  examId,
  examName,
  redirectTo,
}: {
  examId: string
  examName: string
  redirectTo?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleDelete = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/exam/${examId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setOpen(false)
      if (redirectTo) {
        router.push(redirectTo)
      } else {
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); setOpen(true) }}
        aria-label="Delete exam"
        title="Delete exam"
        className="rounded-control p-2 text-ink-muted transition-colors hover:bg-surface-inset hover:text-ink-secondary"
      >
        <Trash2 size={18} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-card border border-border-hair bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-[18px] text-ink">Delete exam?</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              This permanently deletes <span className="text-ink">{examName}</span> and all its
              topics, questions, files, and progress. This cannot be undone.
            </p>
            {error && <p className="mt-3 text-sm text-coral-soft">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="rounded-control px-4 py-2 text-sm text-ink-secondary hover:bg-surface-inset disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="rounded-control bg-coral px-4 py-2 text-sm text-white hover:bg-coral-deep disabled:opacity-50"
              >
                {loading ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
