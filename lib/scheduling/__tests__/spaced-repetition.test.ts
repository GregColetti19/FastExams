import { describe, it, expect } from 'vitest'
import { calculateNextReview, getMasteryScore } from '@/lib/scheduling/spaced-repetition'

const base = { timesCorrect: 0, timesSeen: 0, currentIntervalDays: 1, lastSeenAt: null }

describe('calculateNextReview', () => {
  it('on incorrect: interval resets to 1 day, timesCorrect unchanged', () => {
    const u = calculateNextReview({ ...base, currentIntervalDays: 10, timesCorrect: 3, timesSeen: 5 }, false)
    expect(u.currentIntervalDays).toBe(1)
    expect(u.timesCorrect).toBe(3)
    expect(u.timesSeen).toBe(6)
  })

  it('on correct: interval grows by 2.5x', () => {
    const u = calculateNextReview({ ...base, currentIntervalDays: 4, timesCorrect: 1, timesSeen: 1 }, true)
    expect(u.currentIntervalDays).toBe(10) // 4 * 2.5
    expect(u.timesCorrect).toBe(2)
    expect(u.timesSeen).toBe(2)
  })

  it('caps interval at 30 days', () => {
    const u = calculateNextReview({ ...base, currentIntervalDays: 20 }, true) // 20*2.5=50 → 30
    expect(u.currentIntervalDays).toBe(30)
  })

  it('first correct from interval 1 → 2.5 days', () => {
    const u = calculateNextReview({ ...base, currentIntervalDays: 1 }, true)
    expect(u.currentIntervalDays).toBe(2.5)
  })

  it('sets nextReviewAt in the future', () => {
    const u = calculateNextReview(base, true)
    expect(u.nextReviewAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('getMasteryScore', () => {
  it('returns 0 when never seen', () => {
    expect(getMasteryScore(0, 0)).toBe(0)
  })
  it('returns rounded percentage', () => {
    expect(getMasteryScore(1, 1)).toBe(100)
    expect(getMasteryScore(1, 2)).toBe(50)
    expect(getMasteryScore(2, 3)).toBe(67)
  })
})
