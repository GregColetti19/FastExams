// Per-user daily upload budget, measured in megabytes rather than file count.
//
// AI spend scales with how much text comes out of a file, not with how many
// files were sent — three 50MB lecture decks cost far more to ingest than three
// 2MB ones. A file-count cap would let one tester burn a disproportionate share
// of the alpha budget, so the budget is denominated in bytes.
//
// Size is a proxy for spend, not a measure of it: a 50MB scanned PDF holds less
// text than a 10MB digital one. This is the cheap guard that keeps a runaway
// loop bounded; the provider-side spend cap is the real backstop.

// 200MB ≈ 4 uploads/day at the 50MB per-file cap. At the measured ~$0.30/exam
// that bounds one account near $1.20/day, so ten testers cannot outrun a $50
// alpha budget in a day.
export const DAILY_UPLOAD_BUDGET_MB = Number(process.env.DAILY_UPLOAD_BUDGET_MB || '200')

const MB = 1024 * 1024

export interface QuotaCheck {
  allowed: boolean
  usedMB: number
  budgetMB: number
  remainingMB: number
}

/**
 * Decide whether one more upload of `incomingBytes` fits in the budget, given
 * the sizes already uploaded inside the window.
 *
 * A file is allowed when it fits in what remains. A single file larger than the
 * whole budget can therefore never be uploaded — intended: the budget is the
 * ceiling on what one person can spend in a day, in one file or ten.
 */
export function checkUploadQuota(
  recentSizesBytes: number[],
  incomingBytes: number,
  budgetMB: number = DAILY_UPLOAD_BUDGET_MB
): QuotaCheck {
  const usedBytes = recentSizesBytes.reduce((sum, n) => sum + (n || 0), 0)
  const budgetBytes = budgetMB * MB
  const remainingBytes = Math.max(0, budgetBytes - usedBytes)

  return {
    allowed: incomingBytes <= remainingBytes,
    usedMB: Math.round((usedBytes / MB) * 10) / 10,
    budgetMB,
    remainingMB: Math.round((remainingBytes / MB) * 10) / 10,
  }
}

/** Start of the rolling 24h window used for the budget. */
export function windowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000)
}
