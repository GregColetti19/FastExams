import { describe, it, expect, afterEach } from 'vitest'
import { decideGrounding, relativeGatesEnabled } from '@/lib/ai/grounding-gate'

describe('decideGrounding', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('defaults to absolute strategy (flag off)', () => {
    delete process.env.RETRIEVAL_RELATIVE_GATES
    expect(relativeGatesEnabled()).toBe(false)
    const d = decideGrounding({
      bestScore: 0.3, candidateScores: [0.3, 0.29], hasSubtopic: true, matchMinScore: 0.25,
    })
    expect(d.strategy).toBe('absolute')
    expect(d.grounded).toBe(true) // 0.3 >= 0.25
  })

  it('absolute requires a subtopic', () => {
    const d = decideGrounding({
      bestScore: 0.9, candidateScores: [0.9], hasSubtopic: false, matchMinScore: 0.25,
    })
    expect(d.absolute).toBe(false)
  })

  it('always computes both decisions for comparison', () => {
    // Low absolute score but a clear standout vs a flat pool → relative accepts.
    const d = decideGrounding({
      bestScore: 0.2, candidateScores: [0.2, 0.05, 0.04, 0.05], hasSubtopic: true, matchMinScore: 0.25,
    })
    expect(d.absolute).toBe(false)   // 0.2 < 0.25
    expect(d.relative).toBe(true)    // stands out from the pool
  })

  it('flag on makes relative govern grounded', () => {
    process.env.RETRIEVAL_RELATIVE_GATES = 'true'
    const d = decideGrounding({
      bestScore: 0.2, candidateScores: [0.2, 0.05, 0.04, 0.05], hasSubtopic: true, matchMinScore: 0.25,
    })
    expect(d.strategy).toBe('relative')
    expect(d.grounded).toBe(true)
  })

  it('a flat pool (nothing stands out) fails the relative gate', () => {
    process.env.RETRIEVAL_RELATIVE_GATES = 'true'
    process.env.RETRIEVAL_RELATIVE_RATIO = '1.1'
    const d = decideGrounding({
      bestScore: 0.5, candidateScores: [0.5, 0.5, 0.5, 0.5], hasSubtopic: true, matchMinScore: 0.25,
    })
    // ratio = 1.0 < 1.1 and MAD = 0 → both arms fail.
    expect(d.relative).toBe(false)
  })
})
