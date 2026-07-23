// Retrieval thresholds as injectable config.
//
// Across faculties and languages the corpus produces genuinely different
// cosine-similarity distributions (formula-dense physics vs discursive
// humanities), so a single global constant will be wrong for someone. These
// five knobs are the tuning surface. Today getRetrievalConfig returns the same
// defaults for every input (env-overridable); the subject/language params exist
// so per-subject/language profiles can be added later WITHOUT touching call
// sites. Do not invent per-subject values here — there is no data to justify any
// yet, and guessing them is exactly the domain-hardcoding the brief forbids.

export interface RetrievalConfig {
  /** Min cosine score to attempt grounding a past-exam question at all. */
  matchMinScore: number
  /** Min best-vs-second margin for a chunk→subtopic assignment to count confident. */
  confidentMargin: number
  /** Chunks nearest each subtopic description used to seed its center. */
  seedK: number
  /** Assignment refinement passes. */
  iters: number
  /** ANN candidates fetched per past-exam question (pgvector match_count). */
  annCandidates: number
}

// Defaults = today's hardcoded values (route:EMBED_MATCH_MIN_SCORE,
// assign-subtopics:DEFAULTS, match-to-theory:match_count). Changing none of the
// env vars is a behavioural no-op.
const DEFAULTS: RetrievalConfig = {
  matchMinScore: 0.25,
  confidentMargin: 0.03,
  seedK: 3,
  iters: 2,
  annCandidates: 5,
}

function num(envVar: string, fallback: number): number {
  const v = process.env[envVar]
  const n = v === undefined ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Resolve retrieval config. subject/language are accepted but unused today —
 * they are the seam for per-subject profiles. Env overrides apply globally for
 * now (RETRIEVAL_MATCH_MIN_SCORE etc.).
 */
export function getRetrievalConfig(_opts?: {
  subject?: string
  language?: string
}): RetrievalConfig {
  return {
    matchMinScore: num('RETRIEVAL_MATCH_MIN_SCORE', DEFAULTS.matchMinScore),
    confidentMargin: num('RETRIEVAL_CONFIDENT_MARGIN', DEFAULTS.confidentMargin),
    seedK: num('RETRIEVAL_SEED_K', DEFAULTS.seedK),
    iters: num('RETRIEVAL_ITERS', DEFAULTS.iters),
    annCandidates: num('RETRIEVAL_ANN_CANDIDATES', DEFAULTS.annCandidates),
  }
}

/** median, p10, p90 of a numeric array (returns 0s when empty). */
export function scoreStats(scores: number[]): { median: number; p10: number; p90: number } {
  if (scores.length === 0) return { median: 0, p10: 0, p90: 0 }
  const s = [...scores].sort((a, b) => a - b)
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { median: at(0.5), p10: at(0.1), p90: at(0.9) }
}
