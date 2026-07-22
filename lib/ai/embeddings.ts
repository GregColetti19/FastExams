// Embedding-based retrieval support.
//
// Default: OpenAI text-embedding-3-small (1536d) via REST (no SDK dep). Model,
// dimension, base URL and key are env-driven so the embedding model can be
// evaluated/swapped by config alone (e.g. Qwen3-Embedding, BGE-M3, Cohere) —
// see the vector-space safety notes below before changing the default.
// Mock mode (MOCK_AI) uses a deterministic hashing embedder so the retrieval
// pipeline runs token-free in tests while still reflecting lexical similarity.

// Defaults are today's values; overriding these does not change default behaviour.
export const EMBED_MODEL = process.env.EMBED_MODEL_ID || 'text-embedding-3-small'
export const EMBED_DIM = Number(process.env.EMBED_DIMENSIONS) || 1536
// Base URL for the OpenAI-shaped /embeddings endpoint. OpenRouter/DeepInfra/etc.
// implement the same request shape; point EMBED_BASE_URL at them to swap providers.
const EMBED_BASE_URL = process.env.EMBED_BASE_URL || 'https://api.openai.com/v1'
// Model-dependent: text-embedding-3-small caps at 8191 tokens/input (~32k chars).
// Other models vary enormously (512 tokens .. 128K) — revisit on any model swap.
const MAX_INPUT_CHARS = Number(process.env.EMBED_MAX_INPUT_CHARS) || 8000
// Model-dependent batch size; keep modest to stay under the per-request budget.
const EMBED_BATCH = Number(process.env.EMBED_BATCH) || 96

/**
 * Retrieval role of a text. Asymmetric models (Cohere embed-v4 search_document/
 * search_query, Qwen3 instruction prefixes) exploit this; OpenAI's model cannot,
 * so it is a no-op for the default provider. Threaded through now so an
 * asymmetric model can be evaluated by config alone.
 */
export type EmbedInputType = 'document' | 'query'

/** Embeddings piggyback on the AI mock flag — same token-free dev switch. */
export function isEmbedMockEnabled(): boolean {
  const v = process.env.MOCK_AI
  return v === 'true' || v === '1'
}

function resolveEmbedKey(): string {
  // EMBED_API_KEY -> OPEN_ROUTER_API_KEY -> OPENAI_API_KEY. Default OpenAI path
  // keeps working via OPENAI_API_KEY; OpenRouter via the already-present key.
  const key =
    process.env.EMBED_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error(
      'No embedding API key set (needs EMBED_API_KEY, OPEN_ROUTER_API_KEY, or OPENAI_API_KEY)'
    )
  }
  return key
}

// ponytail: inputType is accepted + threaded but not sent to OpenAI (no-op);
// wire it into the request body when an asymmetric provider is configured.
export async function embedTexts(
  texts: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  inputType: EmbedInputType = 'document'
): Promise<number[][]> {
  if (texts.length === 0) return []
  if (isEmbedMockEnabled()) return texts.map(mockEmbed)

  const apiKey = resolveEmbedKey()

  // Truncate oversized inputs (a single over-limit input 400s the whole call).
  const inputs = texts.map((t) => (t || '').slice(0, MAX_INPUT_CHARS))

  const batches: string[][] = []
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    batches.push(inputs.slice(i, i + EMBED_BATCH))
  }

  const results = await Promise.all(
    batches.map(async (batch, bi) => {
      const body: Record<string, unknown> = { model: EMBED_MODEL, input: batch }
      // Matryoshka/MRL dimension truncation — only sent when explicitly configured
      // (OpenAI 3-* and Qwen3-Embedding support it; omit otherwise).
      if (process.env.EMBED_DIMENSIONS) body.dimensions = EMBED_DIM

      const res = await fetch(`${EMBED_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const offset = bi * EMBED_BATCH
        throw new Error(
          `Embeddings ${res.status} (${EMBED_BASE_URL}, batch ${offset}-${offset + batch.length}): ${await res.text()}`
        )
      }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> }
      const vecs = data.data.map((d) => d.embedding)
      // Vector-space safety: vectors from different models/dims are not comparable
      // and mixing them yields garbage similarity rather than errors. Fail loudly
      // rather than write a wrong-dimension vector into pgvector(1536).
      if (vecs[0] && vecs[0].length !== EMBED_DIM) {
        throw new Error(
          `Embedding dim mismatch: model "${EMBED_MODEL}" returned ${vecs[0].length}, ` +
          `expected ${EMBED_DIM}. Refusing to write incomparable vectors.`
        )
      }
      return vecs
    }),
  )
  return results.flat()
}

export async function embedText(
  text: string,
  inputType: EmbedInputType = 'document'
): Promise<number[]> {
  const [v] = await embedTexts([text], inputType)
  return v
}

/** Full cosine similarity (does not assume unit-norm inputs). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// --- deterministic mock embedder (lexical hashing into EMBED_DIM) -----------

function hashToken(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mockEmbed(text: string): number[] {
  const v = new Array(EMBED_DIM).fill(0)
  const tokens = text.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  for (const tok of tokens) {
    v[hashToken(tok) % EMBED_DIM] += 1
  }
  // Normalize so cosine reflects token-overlap, not length.
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => x / norm)
}
