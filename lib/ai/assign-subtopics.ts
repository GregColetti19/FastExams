import { cosineSimilarity } from './embeddings'

// Seeded-refinement assignment of theory chunks to subtopics.
//
// The page-pile analogy: pin every chunk on a meaning-map. Seed each subtopic
// from the few chunks nearest its description (the spark). Then repeatedly:
// assign each chunk to the nearest subtopic CENTER, keep the confident ones,
// and recompute each center from its confident members. Confident clumps sharpen
// the centers, which place the leftover chunks. Stubborn (low-margin) chunks are
// left "unconfident" for an optional LLM tie-break upstream.

export interface SubtopicSeed {
  topic: string
  name: string
  /** Embedding of the subtopic's description (the initial spark). */
  embedding: number[]
}

export interface ChunkVec {
  id: string
  embedding: number[]
}

export interface Assignment {
  chunkId: string
  topic: string | null
  subtopic: string | null
  /** Gap between best and second-best subtopic similarity (higher = clearer). */
  margin: number
  /** Best similarity score. */
  score: number
  confident: boolean
}

export interface AssignOptions {
  /** Chunks nearest each description used to seed its center. */
  seedK?: number
  /** Refinement passes (assign → recompute centers). */
  iters?: number
  /** Min best-vs-second margin to count an assignment as confident. */
  confidentMargin?: number
}

const DEFAULTS = { seedK: 3, iters: 2, confidentMargin: 0.03 }

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0].length
  const out = new Array(dim).fill(0)
  for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i]
  for (let i = 0; i < dim; i++) out[i] /= vectors.length
  return out
}

/** Best and second-best (index, score) of a chunk against all centers. */
function rank(chunkEmb: number[], centers: number[][]): { best: number; bestScore: number; secondScore: number } {
  let best = -1
  let bestScore = -Infinity
  let secondScore = -Infinity
  for (let s = 0; s < centers.length; s++) {
    const score = cosineSimilarity(chunkEmb, centers[s])
    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      best = s
    } else if (score > secondScore) {
      secondScore = score
    }
  }
  return { best, bestScore, secondScore: secondScore === -Infinity ? 0 : secondScore }
}

export function assignChunksToSubtopics(
  chunks: ChunkVec[],
  subtopics: SubtopicSeed[],
  options: AssignOptions = {}
): Assignment[] {
  const { seedK, iters, confidentMargin } = { ...DEFAULTS, ...options }

  if (chunks.length === 0) return []
  if (subtopics.length === 0) {
    return chunks.map((c) => ({
      chunkId: c.id, topic: null, subtopic: null, margin: 0, score: 0, confident: false,
    }))
  }

  // --- Seed: each center = mean of the seedK chunks nearest its description ---
  let centers: number[][] = subtopics.map((s) => {
    const scored = chunks
      .map((c) => ({ emb: c.embedding, sim: cosineSimilarity(c.embedding, s.embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, Math.min(seedK, chunks.length))
    return meanVector(scored.map((x) => x.emb))
  })

  // --- Refine: assign → keep confident → recompute centers from them ---
  let final: Assignment[] = []
  for (let iter = 0; iter < Math.max(1, iters); iter++) {
    final = chunks.map((c) => {
      const { best, bestScore, secondScore } = rank(c.embedding, centers)
      const margin = bestScore - secondScore
      return {
        chunkId: c.id,
        topic: subtopics[best].topic,
        subtopic: subtopics[best].name,
        margin,
        score: bestScore,
        confident: margin >= confidentMargin,
      }
    })

    // Recompute each center from its confident members (keep old center if none).
    const next = centers.map((prev, s) => {
      const members = final
        .map((a, i) => ({ a, emb: chunks[i].embedding }))
        .filter((x) => x.a.confident && x.a.subtopic === subtopics[s].name)
        .map((x) => x.emb)
      return members.length > 0 ? meanVector(members) : prev
    })
    centers = next
  }

  return final
}
