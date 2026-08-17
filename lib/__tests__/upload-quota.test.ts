import { describe, it, expect } from 'vitest'
import { checkUploadQuota, windowStart, DAILY_UPLOAD_BUDGET_MB } from '../upload-quota'

const MB = 1024 * 1024

describe('DAILY_UPLOAD_BUDGET_MB', () => {
  it('leaves room for more than one upload at the 50MB per-file cap', () => {
    // A budget below the per-file limit would reject every second upload; below
    // the limit itself it would reject all of them.
    expect(DAILY_UPLOAD_BUDGET_MB).toBeGreaterThan(50)
  })
})

describe('checkUploadQuota', () => {
  it('allows an upload that fits in an unused budget', () => {
    const q = checkUploadQuota([], 100 * MB, 400)
    expect(q.allowed).toBe(true)
    expect(q.usedMB).toBe(0)
    expect(q.remainingMB).toBe(400)
  })

  it('sums prior uploads against the budget', () => {
    const q = checkUploadQuota([100 * MB, 50 * MB], 100 * MB, 400)
    expect(q.allowed).toBe(true)
    expect(q.usedMB).toBe(150)
    expect(q.remainingMB).toBe(250)
  })

  it('rejects the upload that would cross the budget', () => {
    const q = checkUploadQuota([350 * MB], 100 * MB, 400)
    expect(q.allowed).toBe(false)
    expect(q.remainingMB).toBe(50)
  })

  it('allows a file that exactly fills the remaining budget', () => {
    const q = checkUploadQuota([300 * MB], 100 * MB, 400)
    expect(q.allowed).toBe(true)
    expect(q.remainingMB).toBe(100)
  })

  it('rejects a single file larger than the whole budget', () => {
    const q = checkUploadQuota([], 500 * MB, 400)
    expect(q.allowed).toBe(false)
  })

  it('never reports negative remaining once over budget', () => {
    const q = checkUploadQuota([900 * MB], 1, 400)
    expect(q.remainingMB).toBe(0)
    expect(q.allowed).toBe(false)
  })

  it('treats null sizes as zero (size_bytes is nullable)', () => {
    const q = checkUploadQuota([null as unknown as number, 100 * MB], 100 * MB, 400)
    expect(q.usedMB).toBe(100)
    expect(q.allowed).toBe(true)
  })
})

describe('windowStart', () => {
  it('is 24h before now', () => {
    const now = new Date('2026-08-17T12:00:00Z')
    expect(windowStart(now).toISOString()).toBe('2026-08-16T12:00:00.000Z')
  })
})
