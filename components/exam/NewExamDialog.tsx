'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/cadence/Button'

export function NewExamDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Dev mode: use mock user
      const mockUserId = '6a7223fc-a96d-434a-9125-98ba6e4daca3'

      const { data, error: dbError } = (await supabase
        .from('exams')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert([
          {
            user_id: mockUserId,
            name,
            description: description || null,
          },
        ] as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select()) as any

      if (dbError) {
        setError(dbError.message)
        return
      }

      if (data && data[0]) {
        router.push(`/exam/${data[0].id}/upload`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        + New exam
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card border border-border-hair bg-surface p-6">
            <h2 className="mb-4 font-display text-[18px] text-ink">New exam</h2>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-ink-secondary">Exam name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Anatomy Year 2"
                  required
                  disabled={loading}
                  className="w-full rounded-control border border-border-hair bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-ink-secondary">Description (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add notes about this exam..."
                  disabled={loading}
                  rows={3}
                  className="w-full rounded-control border border-border-hair bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-border-strong"
                />
              </div>

              {error && (
                <div className="rounded-control bg-coral/10 p-3 text-sm text-coral-soft">{error}</div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={loading || !name}>
                  {loading ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
