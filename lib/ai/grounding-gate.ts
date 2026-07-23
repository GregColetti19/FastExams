// Grounding gate strategies, behind one interface. The choice is config.
//
// Absolute (default): accept when best score clears a fixed threshold. Must be
// re-derived every time the embedding model changes or a new faculty is added.
//
// Relative (RETRIEVAL_RELATIVE_GATES=true, default OFF): self-calibrating —
// accept when the best score stands out from the current question's OWN
// candidate pool (best-vs-second ratio, or best exceeding the pool median by k
// robust standard deviations). Because the reference distribution comes from the
// exam's own candidates, it self-normalises per subject and per model — which
// matters because we expect to change embedding models.
//
// Ships OFF: this changes WHICH questions get answered vs marked UNANSWERABLE.
// Loosening the gate wrong means answering from insufficient grounding — the
// exact failure the never-guess invariant exists to prevent.

export interface GateDecision {
  grounded: boolean
  /** Which strategy produced `grounded`. */
  strategy: 'absolute' | 'relative'
  /** The other strategy's decision, for side-by-side comparison in logs. */
  absolute: boolean
  relative: boolean
}

export function relativeGatesEnabled(): boolean {
  const v = process.env.RETRIEVAL_RELATIVE_GATES
  return v === 'true' || v === '1'
}

/** k robust-SD threshold above pool median (MAD-scaled). Tunable, conservative default. */
function relativeK(): number {
  const n = Number(process.env.RETRIEVAL_RELATIVE_K)
  return Number.isFinite(n) ? n : 1.5
}

/** min best/second ratio for the relative gate's ratio arm. */
function relativeRatio(): number {
  const n = Number(process.env.RETRIEVAL_RELATIVE_RATIO)
  return Number.isFinite(n) ? n : 1.1
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median absolute deviation, scaled to be a robust SD estimate (×1.4826). */
function mad(xs: number[], med: number): number {
  if (xs.length === 0) return 0
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)))
}

/**
 * Decide grounding. Absolute uses `bestScore >= matchMinScore` (with a subtopic).
 * Relative accepts when the best candidate stands out from its pool by EITHER
 * the best/second ratio OR the k·MAD-above-median test. Both decisions are
 * always computed so callers can log the comparison; which one governs is the
 * flag.
 */
export function decideGrounding(params: {
  bestScore: number
  candidateScores: number[]
  hasSubtopic: boolean
  matchMinScore: number
}): GateDecision {
  const { bestScore, candidateScores, hasSubtopic, matchMinScore } = params

  const absolute = bestScore >= matchMinScore && hasSubtopic

  // Relative: needs a subtopic and a non-trivial pool to normalise against.
  let relative = false
  if (hasSubtopic && candidateScores.length >= 2) {
    const sorted = [...candidateScores].sort((a, b) => b - a)
    const second = sorted[1]
    const ratioOk = second > 0 ? bestScore / second >= relativeRatio() : true
    const med = median(candidateScores)
    const spread = mad(candidateScores, med)
    // spread 0 (identical scores) → nothing stands out → fail the SD arm.
    const sdOk = spread > 0 && bestScore >= med + relativeK() * spread
    relative = ratioOk || sdOk
  }

  const useRelative = relativeGatesEnabled()
  return {
    grounded: useRelative ? relative : absolute,
    strategy: useRelative ? 'relative' : 'absolute',
    absolute,
    relative,
  }
}
