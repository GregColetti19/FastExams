// Embedding-based retrieval support.
//
// Real mode calls OpenAI text-embedding-3-small (1536d) via REST (no SDK dep).
// Mock mode (MOCK_AI) uses a deterministic hashing embedder so the retrieval
// pipeline runs token-free in tests while still reflecting lexical similarity.

export const EMBED_MODEL = 'text-embedding-3-small'
export const EMBED_DIM = 1536
// text-embedding-3-small caps at 8191 tokens/input (~32k chars). Truncate well
// under that; chunks should already be ~500 tokens, this is a safety net.
const MAX_INPUT_CHARS = 8000
// OpenAI allows many inputs per request, but keep batches modest to stay under
// the per-request token budget.
const EMBED_BATCH = 96

/** Embeddings piggyback on the AI mock flag — same token-free dev switch. */
export function isEmbedMockEnabled(): boolean {
  const v = process.env.MOCK_AI
  return v === 'true' || v === '1'
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  if (isEmbedMockEnabled()) return texts.map(mockEmbed)

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set (needed for embeddings)')

  // Truncate oversized inputs (a single 8191+ token input 400s the whole call).
  const inputs = texts.map((t) => (t || '').slice(0, MAX_INPUT_CHARS))

  const out: number[][] = []
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH)
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
    })
    if (!res.ok) {
      throw new Error(
        `OpenAI embeddings ${res.status} (batch ${i}-${i + batch.length}): ${await res.text()}`
      )
    }
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> }
    out.push(...data.data.map((d) => d.embedding))
  }
  return out
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedTexts([text])
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
