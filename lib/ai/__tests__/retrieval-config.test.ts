import { describe, it, expect, afterEach } from 'vitest'
import { getRetrievalConfig, scoreStats } from '@/lib/ai/retrieval-config'

describe('getRetrievalConfig', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('returns today\'s defaults with no env set (behavioural no-op)', () => {
    for (const k of [
      'RETRIEVAL_MATCH_MIN_SCORE', 'RETRIEVAL_CONFIDENT_MARGIN',
      'RETRIEVAL_SEED_K', 'RETRIEVAL_ITERS', 'RETRIEVAL_ANN_CANDIDATES',
    ]) delete process.env[k]
    expect(getRetrievalConfig()).toEqual({
      matchMinScore: 0.25, confidentMargin: 0.03, seedK: 3, iters: 2, annCandidates: 5,
    })
  })

  it('env overrides apply; ignores non-numeric', () => {
    process.env.RETRIEVAL_MATCH_MIN_SCORE = '0.4'
    process.env.RETRIEVAL_ANN_CANDIDATES = 'not-a-number'
    const c = getRetrievalConfig()
    expect(c.matchMinScore).toBe(0.4)
    expect(c.annCandidates).toBe(5) // fell back
  })

  it('subject/language do not change output today', () => {
    expect(getRetrievalConfig({ subject: 'physics', language: 'it' }))
      .toEqual(getRetrievalConfig())
  })
})

describe('scoreStats', () => {
  it('handles empty', () => {
    expect(scoreStats([])).toEqual({ median: 0, p10: 0, p90: 0 })
  })
  it('computes percentiles on sorted data', () => {
    const s = scoreStats([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    expect(s.median).toBeCloseTo(0.6, 5)
    expect(s.p10).toBeCloseTo(0.2, 5)
    expect(s.p90).toBeCloseTo(1.0, 5)
  })
})
