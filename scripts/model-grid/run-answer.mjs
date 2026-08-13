#!/usr/bin/env node
/**
 * Stage 4: every answer model answers every generated question, from retrieved
 * theory only. This is the expensive stage (~4,500 calls).
 *
 * The question's own source chunk is NOT handed to the model. Retrieval runs
 * per (embed, question) and the top-K chunks are the only context — so this
 * measures the real pipeline (retrieve, then answer), not a reading-comprehension
 * test. Whether the source chunk was actually retrieved is recorded as
 * `sourceRetrieved`, which is the embedding axis's direct metric.
 *
 * Answer models under the same (embed, gen, subject) prefix see byte-identical
 * questions and byte-identical context, so they are directly comparable.
 *
 * Usage: node scripts/model-grid/run-answer.mjs [--only <embedLabel>] [--limit N]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMBED_MODELS, GEN_MODELS, ANSWER_MODELS, SUBJECTS, RETRIEVAL_K,
  RESULTS_DIR, QWEN_QUERY_INSTRUCTION, loadCorpus, loadEnv, mapLimit, cosine,
} from './config.mjs'
import { chat, embed, parseJson, isAnthropic } from './api.mjs'

loadEnv()

const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null)
const only = arg('--only')
const limit = arg('--limit') ? Number(arg('--limit')) : null

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answerable: { type: 'boolean' },
    choice: { type: 'string' },
    confidence: { type: 'number' },
    source_quote: { type: 'string' },
  },
  required: ['answerable', 'choice', 'confidence', 'source_quote'],
  additionalProperties: false,
}

// Mirrors the production never-guess invariant in lib/ai/answer-exam-question.ts:
// answer only from the source, abstain rather than guess, quote the support.
const SYSTEM = `You are an expert examiner answering exam multiple-choice questions.
You answer ONLY from the provided source material — never from outside knowledge.
If the source does not contain enough information to determine the answer, you say so instead of guessing.
Always respond with valid JSON only. No preamble, no markdown fences.`

function userPrompt(question, options, theory) {
  const letters = ['A', 'B', 'C', 'D']
  return `Answer this multiple-choice question using ONLY the source material below.

Question: ${question}
Options:
${options.map((o, i) => `${letters[i]}. ${o}`).join('\n')}

Source material:
${theory}

Rules:
- Pick the correct option ONLY if the source material supports it.
- Quote the exact supporting sentence from the source in "source_quote".
- If the source does NOT contain enough information, set "answerable": false, "confidence": 0, "choice": "".
- "confidence" is 0.0-1.0: how strongly the source supports your choice.
- "choice" is the option letter (A, B, C or D).

Respond with:
{"answerable": true, "choice": "B", "confidence": 0.0, "source_quote": "..."}`
}

/**
 * Grounding: is the model's source_quote actually supported by the context it
 * was given, or recited from training data?
 *
 * A plain verbatim substring test does not work on this corpus. markitdown
 * renders these PDFs as markdown tables — 84% of philosophy chunks and 96% of
 * NAPDE chunks are full of `|` cell padding — so a model that faithfully quotes
 * a chunk writes the prose back as prose and fails a literal match on
 * *formatting*. (Measured: that test made better retrieval look like worse
 * grounding, which is backwards.)
 *
 * So: strip table/markdown syntax from both sides, then score by contiguous
 * 5-gram overlap. Order matters — that is the point. A bag-of-words containment
 * score was tried first and is useless here: a fabricated sentence scores 1.0
 * because its individual common words all appear *somewhere* in a 150K-char
 * corpus. Shingles cannot be faked by scattered vocabulary.
 *
 * Measured on this corpus: invented-but-plausible sentences score 0.000, honest
 * quotes from table-mangled chunks score 1.000.
 */
const normText = (s) =>
  String(s || '')
    .replace(/\|/g, ' ')
    .replace(/[*_`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()

const NGRAM = 5
// Partial credit is real: models legitimately stitch across a `---` chunk
// boundary or drop a mangled glyph. Half the shingles matching still means the
// quote came from the context, not from memory.
const GROUND_THRESHOLD = 0.5

function gradeGrounding(quote, theory) {
  if (!quote || quote.length < 20) return { grounded: false, score: 0 }
  const qt = normText(quote)
  const tt = normText(theory)
  if (tt.includes(qt)) return { grounded: true, score: 1 }
  const w = qt.split(' ').filter(Boolean)
  if (w.length < NGRAM) return { grounded: false, score: 0 }
  let hit = 0
  let tot = 0
  for (let i = 0; i + NGRAM <= w.length; i++) {
    tot++
    if (tt.includes(w.slice(i, i + NGRAM).join(' '))) hit++
  }
  const score = tot ? hit / tot : 0
  return { grounded: score >= GROUND_THRESHOLD, score }
}

/** Embed all question texts once per embedding model (queries, not documents). */
async function embedQueries(embedModel, questions) {
  const cacheFile = join(RESULTS_DIR, 'qvectors', `${embedModel.label}__${questions.key}.json`)
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'))

  // Asymmetric models (Qwen3) want an instruction on the query side only —
  // without it retrieval measurably degrades, which would unfairly penalise them.
  const prefix = embedModel.asymmetric ? QWEN_QUERY_INSTRUCTION : ''
  const texts = questions.list.map((q) => prefix + q.question_text)

  const batches = []
  for (let i = 0; i < texts.length; i += 64) batches.push(texts.slice(i, i + 64))
  const res = await mapLimit(batches, 3, async (b) =>
    (await embed({ model: embedModel.id, texts: b, dimensions: embedModel.dimensions })).vectors
  )
  const vectors = res.flat()
  mkdirSync(join(RESULTS_DIR, 'qvectors'), { recursive: true })
  writeFileSync(cacheFile, JSON.stringify(vectors))
  return vectors
}

async function runCell(embedModel, genModel, answerModel, subject) {
  const key = `${embedModel.label}__${genModel.label}__${answerModel.label}__${subject}`
  const out = join(RESULTS_DIR, 'answers', `${key}.json`)
  if (existsSync(out)) {
    console.log(`    ${answerModel.label.padEnd(15)} cached`)
    return JSON.parse(readFileSync(out, 'utf8'))
  }

  const qFile = join(RESULTS_DIR, 'questions', `${embedModel.label}__${genModel.label}__${subject}.json`)
  if (!existsSync(qFile)) { console.log(`    ${answerModel.label}: no questions file, skipped`); return null }
  const qData = JSON.parse(readFileSync(qFile, 'utf8'))
  let questions = qData.questions
  if (limit) questions = questions.slice(0, limit)
  if (questions.length === 0) return null

  const { chunks } = loadCorpus(subject)
  const emb = JSON.parse(readFileSync(join(RESULTS_DIR, 'embeddings', `${embedModel.label}__${subject}.json`), 'utf8'))
  const qVecs = await embedQueries(embedModel, {
    key: `${genModel.label}__${subject}${limit ? `__l${limit}` : ''}`,
    list: questions,
  })

  const byId = new Map(chunks.map((c, i) => [c.id, i]))

  let cost = 0, inTok = 0, outTok = 0, latency = 0, malformed = 0
  const rows = await mapLimit(
    questions,
    5,
    async (q, qi) => {
      // Retrieve top-K by cosine, excluding nothing: the source chunk competes
      // like any other, and whether it wins is the retrieval metric.
      const sims = emb.vectors.map((v, i) => [i, cosine(qVecs[qi], v)])
      sims.sort((a, b) => b[1] - a[1])
      const topK = sims.slice(0, RETRIEVAL_K)
      const srcIdx = byId.get(q.sourceChunkId)
      const sourceRetrieved = topK.some(([i]) => i === srcIdx)
      const sourceRank = sims.findIndex(([i]) => i === srcIdx) + 1
      const theory = topK.map(([i]) => chunks[i].text).join('\n\n---\n\n')

      const correctIdx = q.options.findIndex((o) => o.is_correct)
      const r = await chat({
        model: answerModel.id,
        system: SYSTEM,
        user: userPrompt(q.question_text, q.options.map((o) => o.text), theory),
        maxTokens: 1024,
        schema: isAnthropic(answerModel.id) ? undefined : ANSWER_SCHEMA,
        pricePerM: answerModel.pricePerM,
        mandatoryReasoning: answerModel.mandatoryReasoning,
      })
      cost += r.cost; inTok += r.inTok; outTok += r.outTok; latency += r.latencyMs

      const p = parseJson(r.text)
      if (!p) malformed++

      const choice = String(p?.choice ?? '').trim().toUpperCase().slice(0, 1)
      const choiceIdx = choice ? 'ABCD'.indexOf(choice) : -1
      const quote = String(p?.source_quote ?? '').trim()
      const { grounded: quoteGrounded, score: groundScore } = gradeGrounding(quote, theory)

      return {
        qId: q.id,
        answerable: p?.answerable === true,
        choiceIdx,
        confidence: typeof p?.confidence === 'number' ? p.confidence : 0,
        // The "correct" answer is the generator's own key — a claim, not truth.
        // Agreement with it is reported as `matchesKey`, never as accuracy.
        matchesKey: choiceIdx >= 0 && choiceIdx === correctIdx,
        quoteGrounded,
        groundScore: Number(groundScore.toFixed(3)),
        // Persisted so grounding can be re-graded offline if the metric changes
        // — without it the whole stage has to be re-run and re-paid for.
        quote: quote.slice(0, 400),
        quoteLen: quote.length,
        sourceRetrieved,
        sourceRank,
        parsed: !!p,
      }
    },
    { label: `${answerModel.label}/${subject}` }
  )

  const ok = rows.filter((r) => r && !r.__error)
  const apiErrors = rows.length - ok.length
  const answered = ok.filter((r) => r.answerable)

  const payload = {
    embedModel: embedModel.label, genModel: genModel.label,
    answerModel: answerModel.label, subject,
    n: ok.length, apiErrors, malformed,
    answeredRate: ok.length ? answered.length / ok.length : 0,
    keyAgreementRate: answered.length ? answered.filter((r) => r.matchesKey).length / answered.length : 0,
    groundedRate: answered.length ? answered.filter((r) => r.quoteGrounded).length / answered.length : 0,
    retrievalHitRate: ok.length ? ok.filter((r) => r.sourceRetrieved).length / ok.length : 0,
    meanConfidence: answered.length ? answered.reduce((s, r) => s + r.confidence, 0) / answered.length : 0,
    cost, inTok, outTok, avgLatencyMs: ok.length ? Math.round(latency / ok.length) : 0,
    rows: ok,
  }
  mkdirSync(join(RESULTS_DIR, 'answers'), { recursive: true })
  writeFileSync(out, JSON.stringify(payload))
  console.log(
    `    ${answerModel.label.padEnd(15)} n=${String(payload.n).padStart(2)} ` +
    `ans=${(payload.answeredRate * 100).toFixed(0).padStart(3)}% ` +
    `key=${(payload.keyAgreementRate * 100).toFixed(0).padStart(3)}% ` +
    `grnd=${(payload.groundedRate * 100).toFixed(0).padStart(3)}% ` +
    `ret=${(payload.retrievalHitRate * 100).toFixed(0).padStart(3)}% ` +
    `$${payload.cost.toFixed(4)} ${payload.avgLatencyMs}ms`
  )
  return payload
}

async function main() {
  let total = 0
  for (const embedModel of EMBED_MODELS) {
    if (only && embedModel.label !== only) continue
    for (const genModel of GEN_MODELS) {
      for (const subject of SUBJECTS) {
        console.log(`\n=== ${embedModel.label} x ${genModel.label} x ${subject} ===`)
        for (const answerModel of ANSWER_MODELS) {
          const r = await runCell(embedModel, genModel, answerModel, subject)
          total += r?.cost || 0
        }
      }
    }
  }
  console.log(`\nAnswer stage total: $${total.toFixed(4)}`)
}

main()
