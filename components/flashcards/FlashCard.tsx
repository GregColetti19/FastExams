'use client'

import { useState } from 'react'
import { Button } from '@/components/cadence/Button'

interface FlashCardProps {
  front: string
  back: string
  onGotIt: () => void
  onMissedIt: () => void
}

export function FlashCard({ front, back, onGotIt, onMissedIt }: FlashCardProps) {
  const [flipped, setFlipped] = useState(false)

  return (
    <div className="space-y-6">
      {/* Card — 250ms 3D flip per Cadence motion spec */}
      <div
        className="h-64 cursor-pointer"
        onClick={() => setFlipped(!flipped)}
        style={{ perspective: '1000px' }}
      >
        <div
          className="motion-safe:transition-transform motion-safe:duration-[250ms] relative h-full w-full"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Front */}
          <div
            className="absolute flex h-full w-full items-center justify-center rounded-card border border-border-hair bg-surface p-8 text-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-muted">prompt</p>
              <p className="font-display text-xl text-ink">{front}</p>
              <p className="mt-4 text-xs text-ink-muted">Click to reveal answer</p>
            </div>
          </div>

          {/* Back */}
          <div
            className="absolute flex h-full w-full items-center justify-center rounded-card border border-teal-700/30 bg-teal-800/10 p-8 text-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-muted">answer</p>
              <p className="text-lg text-ink">{back}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Rating — binary default (§8.5): Again / Got it */}
      {flipped && (
        <div className="flex gap-3">
          <Button
            variant="ghost"
            size="lg"
            className="flex-1 border-coral/50 text-coral-soft hover:border-coral"
            onClick={onMissedIt}
          >
            Again
          </Button>
          <Button variant="confirm" size="lg" className="flex-1" onClick={onGotIt}>
            Got it
          </Button>
        </div>
      )}
    </div>
  )
}
