'use client'

import { useState } from 'react'

interface FlashCardProps {
  front: string
  back: string
  onGotIt: () => Promise<void>
  onMissedIt: () => Promise<void>
}

export function FlashCard({ front, back, onGotIt, onMissedIt }: FlashCardProps) {
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleGotIt = async () => {
    setLoading(true)
    try {
      await onGotIt()
    } finally {
      setLoading(false)
    }
  }

  const handleMissedIt = async () => {
    setLoading(true)
    try {
      await onMissedIt()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Card */}
      <div
        className="h-64 cursor-pointer perspective"
        onClick={() => !loading && setFlipped(!flipped)}
        style={{
          perspective: '1000px',
        }}
      >
        <div
          className="relative w-full h-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Front */}
          <div
            className="absolute w-full h-full bg-white rounded-lg shadow-lg p-8 flex items-center justify-center text-center border-2 border-blue-200"
            style={{
              backfaceVisibility: 'hidden',
            }}
          >
            <div>
              <p className="text-sm text-slate-500 mb-2">Question</p>
              <p className="text-xl font-semibold text-slate-900">{front}</p>
              <p className="text-xs text-slate-400 mt-4">Click to reveal answer</p>
            </div>
          </div>

          {/* Back */}
          <div
            className="absolute w-full h-full bg-gradient-to-br from-green-50 to-blue-50 rounded-lg shadow-lg p-8 flex items-center justify-center text-center border-2 border-green-200"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div>
              <p className="text-sm text-slate-500 mb-2">Answer</p>
              <p className="text-lg text-slate-900">{back}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Buttons - only show after flipped */}
      {flipped && (
        <div className="flex gap-3">
          <button
            onClick={handleGotIt}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            ✓ Got it
          </button>
          <button
            onClick={handleMissedIt}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
          >
            ✗ Missed it
          </button>
        </div>
      )}
    </div>
  )
}
