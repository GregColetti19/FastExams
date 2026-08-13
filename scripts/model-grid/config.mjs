/**
 * Model grid definition + shared helpers.
 *
 * The grid is 3 embed x 3 gen x 5 answer = 45 cells, run over 2 subjects.
 * Answer models are only ever compared against each other *within* the same
 * (embed, gen) prefix — a model that got better chunks or better questions
 * isn't comparable to one that didn't.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const DATA_DIR = join(ROOT, 'scripts/model-grid/data')
export const RESULTS_DIR = join(ROOT, 'scripts/model-grid/results')

/** Load .env.local into process.env (keys live there; never logged). */
export function loadEnv() {
  const f = join(ROOT, '.env.local')
  if (!existsSync(f)) throw new Error('.env.local not found')
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}

// --- axes ------------------------------------------------------------------

// All three embed models must yield 1536-dim vectors: chunks.embedding is
// vector(1536) with an ivfflat index, so a different dim would mean a schema
// migration + full re-embed (explicitly out of scope for this round).
// OpenAI 3-small is natively 1536; the other two are Matryoshka-truncated to it.
export const EMBED_MODELS = [
  {
    id: 'openai/text-embedding-3-small',
    label: '3-small',
    dimensions: 1536,     // native
    asymmetric: false,
    pricePerM: 0.02,
  },
  {
    id: 'qwen/qwen3-embedding-8b',
    label: 'qwen3-8b',
    dimensions: 1536,     // MRL truncation from 4096
    asymmetric: true,     // wants an instruction prefix on the query side only
    pricePerM: 0.01,
  },
  {
    id: 'google/gemini-embedding-2',
    label: 'gemini-embed-2',
    dimensions: 1536,     // MRL truncation
    asymmetric: false,
    pricePerM: 0.20,
  },
]

// Instruction prefix for asymmetric models. Applied to queries only (see
// EMBED_QUERY_INSTRUCTION in lib/ai/embeddings.ts).
export const QWEN_QUERY_INSTRUCTION =
  'Instruct: Given an exam question, retrieve the course material passage that answers it\nQuery: '

export const GEN_MODELS = [
  { id: 'qwen/qwen3.7-flash', label: 'qwen3.7-flash', pricePerM: [0.03, 0.13] },
  // Rejects reasoning effort:'none' ("Reasoning is mandatory for this
  // endpoint"), so it runs at effort:'low'. Its reasoning tokens bill as
  // output — real cost will exceed the list price more than its peers'.
  { id: 'google/gemini-3.5-flash-lite', label: 'gemini-3.5-fl', pricePerM: [0.30, 2.50], mandatoryReasoning: true },
  { id: 'openai/gpt-5.6-luna', label: 'gpt-5.6-luna', pricePerM: [0.10, 0.60] },
]

// claude-sonnet-5 is a bare id on purpose: getClient() routes it to the
// Anthropic SDK on ANTHROPIC_API_KEY, while the '/'-prefixed ids go through
// OpenRouter. One run, two providers.
export const ANSWER_MODELS = [
  { id: 'qwen/qwen3.7-plus', label: 'qwen3.7-plus', pricePerM: [0.32, 1.28] },
  { id: 'deepseek/deepseek-v3.2', label: 'deepseek-v3.2', pricePerM: [0.269, 0.40] },
  { id: 'z-ai/glm-4.7', label: 'glm-4.7', pricePerM: [0.40, 1.75] },
  { id: 'moonshotai/kimi-k2.6', label: 'kimi-k2.6', pricePerM: [0.58, 2.44] },
  { id: 'claude-sonnet-5', label: 'sonnet-5', pricePerM: [2.00, 10.00] },
]

export const SUBJECTS = ['napde', 'philosophy']
export const QUESTIONS_PER_SUBJECT = 50
export const RETRIEVAL_K = 3   // chunks handed to the answer model per question

export function loadCorpus(subject) {
  const f = join(DATA_DIR, `corpus-${subject}.json`)
  if (!existsSync(f)) throw new Error(`Missing ${f} — run prep-corpus.mjs first`)
  return JSON.parse(readFileSync(f, 'utf8'))
}

/** Cosine similarity; vectors here are not assumed unit-norm. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Run tasks with bounded concurrency, retrying transient failures.
 * Rate limits and 5xx are expected across 4.5k calls to six vendors; a run that
 * dies two hours in because one provider hiccuped would be worse than slow.
 */
export async function mapLimit(items, limit, fn, { retries = 3, label = '' } = {}) {
  const out = new Array(items.length)
  let idx = 0
  let done = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      for (let attempt = 0; ; attempt++) {
        try {
          out[i] = await fn(items[i], i)
          break
        } catch (e) {
          if (attempt >= retries) {
            out[i] = { __error: String(e?.message || e) }
            break
          }
          // Base 2s: rate limits on the larger synthesis prompts need longer
          // than the 1s base gave them (jitter avoids retry convoys).
          await sleep(2000 * Math.pow(2, attempt) + Math.random() * 500)
        }
      }
      done++
      if (label && done % 25 === 0) process.stdout.write(`    ${label}: ${done}/${items.length}\r`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (label) process.stdout.write(`    ${label}: ${items.length}/${items.length}    \n`)
  return out
}

/** Cost in USD for one call given [inPrice, outPrice] per 1M tokens. */
export function callCost(pricePerM, inTok, outTok) {
  return (inTok * pricePerM[0] + outTok * pricePerM[1]) / 1e6
}
