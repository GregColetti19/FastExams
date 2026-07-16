'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { IconCheck } from '@tabler/icons-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Active-exam toggle (§7). Only active exams feed the Review queue.
 * Anti-burnout lever — a student can pause a whole exam to stop it flooding Review.
 */
export function ActiveToggle({ examId, active }: { examId: string; active: boolean }) {
  const [isActive, setIsActive] = useState(active)
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (saving) return
    setSaving(true)
    const next = !isActive
    setIsActive(next) // optimistic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('exams') as any).update({ active: next }).eq('id', examId)
    if (error) setIsActive(!next) // revert on failure
    setSaving(false)
    router.refresh()
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      aria-pressed={isActive}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs transition-colors duration-150 disabled:opacity-50',
        isActive ? 'bg-teal-800/20 text-teal-100' : 'bg-surface-inset text-ink-muted'
      )}
    >
      {isActive && <IconCheck size={12} stroke={2.5} />}
      {isActive ? 'active' : 'paused'}
    </button>
  )
}
