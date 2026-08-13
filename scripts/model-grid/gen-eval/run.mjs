#!/usr/bin/env node
/**
 * Generation-model evaluation.
 *
 * Pipeline per generator: generate 100 MCQs from the corpus -> embed the
 * questions -> retrieve top-K -> answer each with the fixed answer model, twice:
 * once WITH the retrieved source and once WITHOUT any source (triviality probe).
 *
 * Options are SHUFFLED before scoring, mirroring the production fix
 * (lib/ai/generate-questions.ts shuffleOptions). Without that, "answerable
 * without source" is unmeasurable: the previous round's generators put the
 * correct answer at position A up to 100% of the time, so a prober scored ~90%
 * by picking A regardless of the question. The generator's *raw* position bias
 * is still recorded (rawKeyPos) — that measures the model; the shuffle measures
 * the questions.
 *
 * Stages are cached per generator, so a failed run resumes without re-paying.
 *
 * Usage: node scripts/model-grid/gen-eval/run.mjs [--only <label>]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, basename } from 'node:path'
import { ROOT, loadEnv, mapLimit, cosine } from '../config.mjs'
import { chat, embed, parseJson } from '../api.mjs'
import {
  CORPORA, N_QUESTIONS, QUESTIONS_PER_CALL, EMBED_MODEL, ANSWER_MODEL,
  GEN_MODELS, RETRIEVAL_K, QWEN_QUERY_INSTRUCTION, GE_DATA, GE_RESULTS,
  SYNTHESIS_CHUNKS,
} from './config.mjs'

loadEnv()
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const PY = join(ROOT, 'converter/venv/bin/python')

// --- stage 0: corpus --------------------------------------------------------

function buildCorpus(CORPUS) {
  const out = join(GE_DATA, `corpus-${CORPUS.id}.json`)
  if (existsSync(out)) return JSON.parse(readFileSync(out, 'utf8'))
  mkdirSync(GE_DATA, { recursive: true })

  const script = `
import sys, warnings
warnings.filterwarnings('ignore')
from markitdown import MarkItDown
sys.stdout.write(MarkItDown().convert(sys.argv[1]).text_content)
`
  const estimateTokens = (t) => Math.ceil(t.length / 4)
  let all = []
  for (const f of CORPUS.files) {
    const md = execFileSync(PY, ['-c', script, join(ROOT, CORPUS.dir, f)], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    })
    // Same chunking as the main eval: split on level-2 headings, then cap by tokens.
    const sections = md.split(/^## /m).filter((s) => s.trim())
    let chunks = []
    const intro = md.match(/^(.*?)\n## /s)
    if (intro && intro[1].trim()) chunks.push(intro[1].trim())
    for (const s of sections) chunks.push(s.split('\n').slice(1).join('\n').trim())
    if (chunks.length === 0) chunks = [md.trim()]

    const split = []
    for (const c of chunks) {
      if (estimateTokens(c) <= 500) { split.push(c); continue }
      const paras = c.split('\n\n')
      let cur = ''
      for (const p of paras) {
        if (estimateTokens(cur) + estimateTokens(p) > 500 && cur) { split.push(cur.trim()); cur = p }
        else cur += (cur ? '\n\n' : '') + p
      }
      if (cur.trim()) split.push(cur.trim())
    }
    const kept = split.filter((t) => t.length >= 200)
    console.log(`  ${f.slice(0, 42).padEnd(44)} ${String(md.length).padStart(7)} chars -> ${kept.length} chunks`)
    all = all.concat(kept.map((text, i) => ({ id: `${basename(f, '.pdf')}:${i}`, text })))
  }
  const payload = { subject: CORPUS.id, name: CORPUS.name, subjectLabel: CORPUS.subject, chunks: all }
  writeFileSync(out, JSON.stringify(payload, null, 2))
  console.log(`  -> ${all.length} chunks, ~${all.reduce((s, c) => s + estimateTokens(c.text), 0).toLocaleString()} tokens\n`)
  return payload
}

// --- shared helpers ---------------------------------------------------------

const normText = (s) => String(s || '').replace(/\|/g, ' ').replace(/[*_`#>]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()

/** Contiguous 5-gram overlap; order-sensitive so scattered vocabulary can't fake it. */
function ngramScore(quote, text, n = 5) {
  if (!quote || quote.length < 20) return 0
  const q = normText(quote), t = normText(text)
  if (t.includes(q)) return 1
  const w = q.split(' ').filter(Boolean)
  if (w.length < n) return 0
  let hit = 0, tot = 0
  for (let i = 0; i + n <= w.length; i++) { tot++; if (t.includes(w.slice(i, i + n).join(' '))) hit++ }
  return tot ? hit / tot : 0
}

/**
 * Mirrors lib/ai/generate-questions.ts hasLengthBias: the correct option is both
 * the longest and >= 25% above the mean wrong option.
 */
const LENGTH_BIAS_RATIO = 1.25
function isLengthBiased(options) {
  const correct = options.find((o) => o.is_correct)
  const wrong = options.filter((o) => !o.is_correct)
  if (!correct || !wrong.length) return false
  if (correct.text.length < Math.max(...wrong.map((o) => o.text.length))) return false
  const meanWrong = wrong.reduce((s, o) => s + o.text.length, 0) / wrong.length
  return meanWrong > 0 && correct.text.length / meanWrong >= LENGTH_BIAS_RATIO
}

/**
 * Rewrite all four options to a common length band. Mirrors production's
 * equalizeOptionLengths, using the fixed answer model rather than the generator
 * so the fix costs the same regardless of which generator is under test.
 * Returns null when the rewrite fails or doesn't remove the bias.
 */
async function equalizeOptions(question, corpus, addCost) {
  const correct = question.options.find((o) => o.is_correct)
  const wrong = question.options.filter((o) => !o.is_correct)
  const target = Math.round(wrong.reduce((s, o) => s + o.text.length, 0) / wrong.length)
  try {
    const r = await chat({
      model: ANSWER_MODEL.id,
      system: 'You rewrite multiple-choice options so that length does not reveal the answer. Respond with JSON only.',
      user: `In this question the correct option is noticeably longer than the wrong ones, which lets students pick it without knowing the material.

Question: ${question.question_text}

Correct option (${correct.text.length} chars): ${correct.text}
Wrong options: ${wrong.map((o) => `(${o.text.length} chars) ${o.text}`).join(' | ')}

Rewrite ALL FOUR options so they are close to ${target} characters each.

Rules:
- Keep the meaning of every option exactly as it is. The correct option must stay correct and the wrong ones must stay wrong.
- Do not make any option vague or ambiguous to shorten it — cut redundancy, not content.
- Write in the same language as the options.

Respond with: {"correct": "...", "wrong": ["...", "...", "..."]}`,
      maxTokens: 1024,
      schema: {
        type: 'object',
        properties: { correct: { type: 'string' }, wrong: { type: 'array', items: { type: 'string' } } },
        required: ['correct', 'wrong'], additionalProperties: false,
      },
      pricePerM: ANSWER_MODEL.pricePerM,
    })
    addCost(r.cost)
    const p = parseJson(r.text)
    if (!p?.correct || !Array.isArray(p.wrong) || p.wrong.length !== wrong.length) return null
    const rewritten = [
      { text: String(p.correct).trim(), is_correct: true },
      ...p.wrong.map((t) => ({ text: String(t).trim(), is_correct: false })),
    ]
    if (rewritten.some((o) => !o.text)) return null
    return isLengthBiased(rewritten) ? null : rewritten
  } catch {
    return null
  }
}

/** Fisher-Yates, seeded so a re-run scores the identical arrangement. */
function shuffleSeeded(arr, seed) {
  const out = [...arr]
  let s = seed
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_text: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, is_correct: { type: 'boolean' } },
              required: ['text', 'is_correct'], additionalProperties: false,
            },
          },
          source_quote: { type: 'string' },
        },
        required: ['question_text', 'options', 'source_quote'], additionalProperties: false,
      },
    },
  },
  required: ['questions'], additionalProperties: false,
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answerable: { type: 'boolean' }, choice: { type: 'string' },
    confidence: { type: 'number' }, source_quote: { type: 'string' },
  },
  required: ['answerable', 'choice', 'confidence', 'source_quote'], additionalProperties: false,
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: { choice: { type: 'string' }, confidence: { type: 'number' } },
  required: ['choice', 'confidence'], additionalProperties: false,
}

// --- stage 1: generate ------------------------------------------------------

async function generate(gen, corpus, chunkVectors) {
  const out = join(GE_RESULTS, 'questions', `${gen.label}__${corpus.subject_id}.json`)
  // Only trust a cache entry that actually holds questions: the credit-exhausted
  // run wrote zero-question files, and an existence-only check then skipped those
  // cells forever instead of retrying them.
  if (existsSync(out)) {
    const cached = JSON.parse(readFileSync(out, 'utf8'))
    if (cached.questions?.length) { console.log(`  [gen] cached`); return cached }
    console.log(`  [gen] cached file has 0 questions — regenerating`)
  }

  const nCalls = Math.ceil(N_QUESTIONS / QUESTIONS_PER_CALL)
  // Farthest-point selection over chunk vectors: spread questions across distinct
  // topics rather than clustering them in the longest section.
  const picked = []
  let start = 0
  for (let i = 1; i < corpus.chunks.length; i++) {
    if (corpus.chunks[i].text.length > corpus.chunks[start].text.length) start = i
  }
  picked.push(start)
  const maxSim = chunkVectors.map((v) => cosine(v, chunkVectors[start]))
  while (picked.length < Math.min(nCalls, corpus.chunks.length)) {
    let best = -1, bestSim = Infinity
    for (let i = 0; i < corpus.chunks.length; i++) {
      if (picked.includes(i)) continue
      if (maxSim[i] < bestSim) { bestSim = maxSim[i]; best = i }
    }
    if (best < 0) break
    picked.push(best)
    for (let i = 0; i < corpus.chunks.length; i++) maxSim[i] = Math.max(maxSim[i], cosine(chunkVectors[i], chunkVectors[best]))
  }

  let cost = 0, malformed = 0, truncated = 0, latency = 0
  const results = await mapLimit(picked, 4, async (ci) => {
    // Synthesis: hand generation the seed chunk plus its nearest neighbours, so
    // a question can span passages the way retrieval will present them at answer
    // time. Previously generation saw ONE chunk while answering retrieved three,
    // so "synthesise across the material" was impossible by construction.
    const neighbours = chunkVectors
      .map((v, i) => [i, cosine(chunkVectors[ci], v)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, SYNTHESIS_CHUNKS)
      .map(([i]) => i)
    const bundle = neighbours.map((i) => corpus.chunks[i].text).join('\n\n---\n\n')

    const r = await chat({
      model: gen.id,
      system: `You are an expert university examiner${corpus.subjectLabel ? ` for ${corpus.subjectLabel}` : ''}. You write exam multiple-choice questions strictly from provided course material.
Always respond with valid JSON only. No preamble, no markdown fences.`,
      user: `Course: ${corpus.name}

Write ${QUESTIONS_PER_CALL} multiple-choice exam questions answerable ONLY from the course material below.
The material contains several passages separated by ---.

Rules:
- Each question must be answerable using the material alone — no outside knowledge.
- Prefer questions that require combining TWO OR MORE passages, or that hinge on a specific condition, hypothesis, constant or step stated in this material. Avoid questions answerable from general familiarity with the field.
- Exactly 4 options, exactly one correct.
- Wrong options must be plausible, not absurd — this is a graduate-level exam.
- Keep all four options similar in length and specificity: each between a short phrase and one full sentence. The correct option must NOT be the longest or most detailed — students otherwise pick it on length alone.
- Draw wrong options from the surrounding material where possible (a neighbouring result, a related condition, the same statement with one hypothesis changed) rather than inventing them.
- Do not ask about document structure ("what does section 2 cover"); ask about the subject matter.
- "source_quote" must be a sentence copied VERBATIM from the material that supports the correct answer.
- Write in the same language as the material.

Course material:
${bundle}

Respond with:
{"questions": [{"question_text": "...", "options": [{"text": "...", "is_correct": true}, {"text": "...", "is_correct": false}, {"text": "...", "is_correct": false}, {"text": "...", "is_correct": false}], "source_quote": "..."}]}`,
      maxTokens: 4096,
      schema: QUESTION_SCHEMA,
      pricePerM: gen.pricePerM,
      mandatoryReasoning: gen.mandatoryReasoning,
    })
    cost += r.cost; latency += r.latencyMs
    if (r.finish === 'length') truncated++
    const p = parseJson(r.text)
    if (!p?.questions) { malformed++; return [] }
    // sourceChunkId = the SEED chunk (retrieval-hit is measured against it).
    // sourceBundleIds = every chunk the generator actually saw; with synthesis a
    // question may rest on a neighbour, so grounding is checked against all of
    // them rather than the seed alone.
    return p.questions.map((q) => ({
      ...q,
      sourceChunkId: corpus.chunks[ci].id,
      sourceChunkIdx: ci,
      sourceBundleIds: neighbours.map((i) => corpus.chunks[i].id),
    }))
  }, { label: `gen/${gen.label}` })

  const apiErrors = results.filter((r) => r?.__error).length
  if (apiErrors) {
    // Surface the actual failure — a bare count sent me chasing rate limits
    // that were not the cause.
    const seen = new Set(results.filter((r) => r?.__error).map((r) => r.__error))
    for (const msg of [...seen].slice(0, 3)) console.log(`    ERR: ${String(msg).slice(0, 220)}`)
  }
  const valid = results.filter((r) => Array.isArray(r)).flat()
    .filter((q) => q?.question_text && Array.isArray(q.options) && q.options.length === 4 &&
                   q.options.filter((o) => o.is_correct).length === 1)
    .slice(0, N_QUESTIONS)

  // Length de-biasing, mirroring production (equalizeOptionLengths). Measured:
  // the correct option is the longest ~50% of the time (25% = unbiased) and a
  // prompt rule did not move it, so it is corrected after generation. The eval
  // must run the same pass or it would score questions the app never ships.
  // rawLenBias is kept so the generator's own tendency stays visible.
  let equalizeCost = 0, equalized = 0
  const debiased = await mapLimit(valid, 4, async (q) => {
    const rawLenBias = isLengthBiased(q.options)
    if (!rawLenBias) return { ...q, rawLenBias }
    const fixed = await equalizeOptions(q, corpus, (c) => { equalizeCost += c })
    if (fixed) equalized++
    return { ...q, options: fixed ?? q.options, rawLenBias }
  }, { label: `fix-len/${gen.label}` })

  const questions = debiased
    .filter((q) => q && !q.__error)
    .map((q, i) => {
      // rawCorrectIdx = where the GENERATOR put the answer (measures the model).
      // The shuffled arrangement is what gets asked (measures the questions).
      const rawCorrectIdx = q.options.findIndex((o) => o.is_correct)
      const shuffled = shuffleSeeded(q.options, i + 1)
      return {
        ...q, id: `q${i}`, rawCorrectIdx,
        options: shuffled,
        correctIdx: shuffled.findIndex((o) => o.is_correct),
      }
    })

  cost += equalizeCost
  const payload = {
    genModel: gen.label, subject: corpus.subject_id,
    requested: N_QUESTIONS, produced: questions.length,
    malformed, truncated, apiErrors, equalized, equalizeCost,
    cost, avgLatencyMs: Math.round(latency / picked.length), questions,
  }
  mkdirSync(join(GE_RESULTS, 'questions'), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2))
  console.log(`  [gen] ${questions.length}/${N_QUESTIONS} questions  malformed=${malformed} trunc=${truncated} apiErr=${apiErrors}  $${cost.toFixed(4)}`)
  return payload
}

// --- stage 2: answer (with source) + probe (no source) ----------------------

async function answerAndProbe(gen, qData, corpus, chunkVectors) {
  const out = join(GE_RESULTS, 'answers', `${gen.label}__${corpus.subject_id}.json`)
  if (existsSync(out)) { console.log(`  [ans] cached`); return JSON.parse(readFileSync(out, 'utf8')) }

  const questions = qData.questions
  // Embed questions as queries (instruction prefix: qwen3 is asymmetric).
  // Cached to disk: without the vectors, any later change to a retrieval metric
  // needs the whole paid stage re-run. That gap is exactly what made the
  // bundle-aware retrieval re-grade impossible after the first pass.
  const qvFile = join(GE_RESULTS, 'qvectors', `${gen.label}__${corpus.subject_id}.json`)
  let qVecs
  if (existsSync(qvFile)) {
    qVecs = JSON.parse(readFileSync(qvFile, 'utf8'))
  } else {
    const texts = questions.map((q) => QWEN_QUERY_INSTRUCTION + q.question_text)
    const batches = []
    for (let i = 0; i < texts.length; i += 64) batches.push(texts.slice(i, i + 64))
    qVecs = (await mapLimit(batches, 3, async (b) =>
      (await embed({ model: EMBED_MODEL.id, texts: b, dimensions: EMBED_MODEL.dimensions })).vectors
    )).flat()
    mkdirSync(join(GE_RESULTS, 'qvectors'), { recursive: true })
    writeFileSync(qvFile, JSON.stringify(qVecs))
  }

  const byId = new Map(corpus.chunks.map((c, i) => [c.id, i]))
  const letters = ['A', 'B', 'C', 'D']
  let cost = 0

  const rows = await mapLimit(questions, 5, async (q, qi) => {
    const sims = chunkVectors.map((v, i) => [i, cosine(qVecs[qi], v)]).sort((a, b) => b[1] - a[1])
    const topK = sims.slice(0, RETRIEVAL_K)
    const srcIdx = byId.get(q.sourceChunkId)
    const theory = topK.map(([i]) => corpus.chunks[i].text).join('\n\n---\n\n')
    const optionsBlock = q.options.map((o, i) => `${letters[i]}. ${o.text}`).join('\n')

    // (a) with source
    const withSrc = await chat({
      model: ANSWER_MODEL.id,
      system: `You are an expert examiner answering exam multiple-choice questions.
You answer ONLY from the provided source material — never from outside knowledge.
If the source does not contain enough information to determine the answer, you say so instead of guessing.
Always respond with valid JSON only. No preamble, no markdown fences.`,
      user: `Answer this multiple-choice question using ONLY the source material below.

Question: ${q.question_text}
Options:
${optionsBlock}

Source material:
${theory}

Rules:
- Pick the correct option ONLY if the source material supports it.
- Quote the exact supporting sentence from the source in "source_quote".
- If the source does NOT contain enough information, set "answerable": false, "confidence": 0, "choice": "".
- "choice" is the option letter (A, B, C or D).

Respond with:
{"answerable": true, "choice": "B", "confidence": 0.0, "source_quote": "..."}`,
      maxTokens: 1024, schema: ANSWER_SCHEMA, pricePerM: ANSWER_MODEL.pricePerM,
    })
    cost += withSrc.cost
    const pa = parseJson(withSrc.text)
    const aIdx = 'ABCD'.indexOf(String(pa?.choice ?? '').trim().toUpperCase().slice(0, 1))

    // (b) no source — triviality. Same model, same options, zero context.
    const noSrc = await chat({
      model: ANSWER_MODEL.id,
      system: 'You answer multiple-choice questions. Respond with JSON only.',
      user: `Answer this multiple-choice question.

Question: ${q.question_text}
Options:
${optionsBlock}

Respond with: {"choice": "B", "confidence": 0.0}`,
      maxTokens: 128, schema: PROBE_SCHEMA, pricePerM: ANSWER_MODEL.pricePerM,
    })
    cost += noSrc.cost
    const pp = parseJson(noSrc.text)
    const pIdx = 'ABCD'.indexOf(String(pp?.choice ?? '').trim().toUpperCase().slice(0, 1))

    return {
      qId: q.id,
      correctIdx: q.correctIdx,
      answerable: pa?.answerable === true,
      choiceIdx: aIdx,
      confidence: typeof pa?.confidence === 'number' ? pa.confidence : 0,
      correctWithSource: aIdx === q.correctIdx,
      answerQuoteGrounded: ngramScore(pa?.source_quote, theory) >= 0.5,
      probeIdx: pIdx,
      correctNoSource: pIdx === q.correctIdx,
      probeConfidence: typeof pp?.confidence === 'number' ? pp.confidence : 0,
      // Seed-only: the chunk the generator was seeded from. Under synthesis this
      // undercounts — a question may legitimately rest on a neighbour.
      sourceRetrieved: topK.some(([i]) => i === srcIdx),
      // Bundle: did retrieval surface ANY chunk the question was built from.
      // This is the honest retrieval measure once generation sees >1 chunk.
      bundleRetrieved: (q.sourceBundleIds?.length ? q.sourceBundleIds : [q.sourceChunkId])
        .map((id) => byId.get(id))
        .filter((i) => i !== undefined)
        .some((i) => topK.some(([j]) => j === i)),
    }
  }, { label: `ans/${gen.label}` })

  const ok = rows.filter((r) => r && !r.__error)
  const payload = { genModel: gen.label, n: ok.length, cost, rows: ok }
  mkdirSync(join(GE_RESULTS, 'answers'), { recursive: true })
  writeFileSync(out, JSON.stringify(payload))
  console.log(`  [ans] n=${ok.length}  $${cost.toFixed(4)}`)
  return payload
}

// --- main -------------------------------------------------------------------

async function main() {
  const onlyCorpus = process.argv.includes('--corpus')
    ? process.argv[process.argv.indexOf('--corpus') + 1]
    : null

  let total = 0
  for (const CORPUS of CORPORA) {
    if (onlyCorpus && CORPUS.id !== onlyCorpus) continue
    console.log(`\n########## corpus: ${CORPUS.name} ##########`)
    const corpus = { ...buildCorpus(CORPUS), subject_id: CORPUS.id }

    // Embed chunks once per corpus — shared by every generator, so retrieval is
    // identical and any difference is attributable to the generator alone.
    const embFile = join(GE_DATA, `chunkvecs-${CORPUS.id}.json`)
    let chunkVectors
    if (existsSync(embFile)) {
      chunkVectors = JSON.parse(readFileSync(embFile, 'utf8'))
    } else {
      const batches = []
      for (let i = 0; i < corpus.chunks.length; i += 64) batches.push(corpus.chunks.slice(i, i + 64))
      chunkVectors = (await mapLimit(batches, 3, async (b) =>
        (await embed({ model: EMBED_MODEL.id, texts: b.map((c) => c.text), dimensions: EMBED_MODEL.dimensions })).vectors
      , { label: 'embed chunks' })).flat()
      writeFileSync(embFile, JSON.stringify(chunkVectors))
    }
    console.log(`  ${chunkVectors.length} chunk vectors ready\n`)

    for (const gen of GEN_MODELS) {
      if (only && gen.label !== only) continue
      console.log(`=== ${gen.label} / ${CORPUS.id} ===`)
      const qData = await generate(gen, corpus, chunkVectors)
      if (!qData.questions.length) { console.log('  no questions, skipping\n'); continue }
      const aData = await answerAndProbe(gen, qData, corpus, chunkVectors)
      total += (qData.cost || 0) + (aData.cost || 0)
      console.log()
    }
  }
  console.log(`\nTotal spend: $${total.toFixed(4)}`)
}

main()
