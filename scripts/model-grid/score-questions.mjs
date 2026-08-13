#!/usr/bin/env node
/**
 * Question-quality metrics for the generation axis.
 *
 * The main grid measures whether a generator returns *well-formed* questions
 * (yield, malformed count). That is reliability, not quality — a model can hit
 * 100% yield with 50 trivial, duplicated, or unanswerable questions. These
 * metrics ask whether the questions are worth asking. All are label-free.
 *
 * Offline (no API calls, from stored artifacts):
 *   dup%        near-duplicate questions (cosine >= 0.92 on the stored question
 *               vectors). High = the model rephrases one idea instead of
 *               covering the material.
 *   keyPos      distribution of the correct option across A/B/C/D. Clustering
 *               is a known cheap-model tell and makes questions guessable.
 *   deadDistr%  options no answer model ever chose. Pure padding — a 4-option
 *               question with 2 dead distractors is really a 2-option question.
 *   quoteOK%    the generator's own source_quote actually appears in the chunk
 *               it claimed to generate from (5-gram, same grader as answers).
 *               Low = the generator invented its evidence.
 *   tooEasy%    every answer model got it right at high confidence.
 *   discrim     spread of correctness across answer models (0 = everyone agrees,
 *               higher = the question separates strong from weak models).
 *
 * Online (--probe, ~$0.60): triviality. Re-answers each question with NO source
 * material. A question answerable from general knowledge alone does not test the
 * course content, which for an exam-prep app is a failure regardless of how
 * well-formed it is.
 *
 * Usage:
 *   node scripts/model-grid/score-questions.mjs
 *   node scripts/model-grid/score-questions.mjs --probe [--probe-n 40]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EMBED_MODELS, GEN_MODELS, SUBJECTS, RESULTS_DIR, loadCorpus, loadEnv, cosine, mapLimit } from './config.mjs'
import { chat, parseJson } from './api.mjs'

loadEnv()
const wantProbe = process.argv.includes('--probe')
const probeN = process.argv.includes('--probe-n') ? Number(process.argv[process.argv.indexOf('--probe-n') + 1]) : 40

const QDIR = join(RESULTS_DIR, 'questions')
const ADIR = join(RESULTS_DIR, 'answers')

// Same grader as the answer stage: normalise markdown-table damage, then score
// contiguous 5-gram overlap. See run-answer.mjs for why word-order matters.
const normText = (s) => String(s || '').replace(/\|/g, ' ').replace(/[*_`#>]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()
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

const DUP_THRESHOLD = 0.92

// --- gather per-(embed,gen,subject) question sets ---------------------------

const stats = new Map()   // genLabel -> accumulator

for (const embed of EMBED_MODELS) {
  for (const gen of GEN_MODELS) {
    for (const subject of SUBJECTS) {
      const qFile = join(QDIR, `${embed.label}__${gen.label}__${subject}.json`)
      if (!existsSync(qFile)) continue
      const qData = JSON.parse(readFileSync(qFile, 'utf8'))
      const questions = qData.questions
      if (!questions.length) continue

      const { chunks } = loadCorpus(subject)
      const byId = new Map(chunks.map((c) => [c.id, c.text]))

      const acc = stats.get(gen.label) ?? {
        n: 0, dup: 0, keyPos: [0, 0, 0, 0], quoteOK: 0,
        deadDistr: 0, distrTot: 0, tooEasy: 0, discrimSum: 0, discrimN: 0,
      }

      // duplicates: use the query vectors already computed for retrieval
      const qvFile = join(RESULTS_DIR, 'qvectors', `${embed.label}__${gen.label}__${subject}.json`)
      if (existsSync(qvFile)) {
        const vecs = JSON.parse(readFileSync(qvFile, 'utf8'))
        for (let i = 0; i < questions.length; i++) {
          for (let j = i + 1; j < questions.length; j++) {
            if (vecs[i] && vecs[j] && cosine(vecs[i], vecs[j]) >= DUP_THRESHOLD) { acc.dup++; break }
          }
        }
      }

      // key position + generator's own quote fidelity
      for (const q of questions) {
        const ci = q.options.findIndex((o) => o.is_correct)
        if (ci >= 0 && ci < 4) acc.keyPos[ci]++
        const src = byId.get(q.sourceChunkId)
        if (src && ngramScore(q.source_quote, src) >= 0.5) acc.quoteOK++
      }

      // distractor liveness + difficulty, from how the 5 answer models responded
      const cells = readdirSync(ADIR)
        .filter((f) => f.startsWith(`${embed.label}__${gen.label}__`) && f.endsWith(`__${subject}.json`))
        .map((f) => JSON.parse(readFileSync(join(ADIR, f), 'utf8')))

      if (cells.length) {
        const byQ = new Map()
        for (const c of cells) for (const r of c.rows) {
          if (!byQ.has(r.qId)) byQ.set(r.qId, [])
          byQ.get(r.qId).push(r)
        }
        for (const q of questions) {
          const rows = byQ.get(q.id) ?? []
          const voted = rows.filter((r) => r.answerable && r.choiceIdx >= 0)
          if (!voted.length) continue
          const chosen = new Set(voted.map((r) => r.choiceIdx))
          acc.deadDistr += q.options.length - chosen.size
          acc.distrTot += q.options.length
          const correctIdx = q.options.findIndex((o) => o.is_correct)
          const right = voted.filter((r) => r.choiceIdx === correctIdx).length
          const frac = right / voted.length
          if (frac === 1 && voted.every((r) => r.confidence >= 0.85)) acc.tooEasy++
          // discrimination: variance of correctness across models, peaks at 0.5
          acc.discrimSum += frac * (1 - frac) * 4
          acc.discrimN++
        }
      }

      acc.n += questions.length
      stats.set(gen.label, acc)
    }
  }
}

const pct = (x) => (100 * x).toFixed(1).padStart(5)

console.log('='.repeat(92))
console.log('QUESTION QUALITY — generation axis (label-free, offline)')
console.log('='.repeat(92))
console.log('model            dup%  quoteOK%  deadDistr%  tooEasy%  discrim  keyPos A/B/C/D')
for (const g of GEN_MODELS) {
  const a = stats.get(g.label)
  if (!a) continue
  const kp = a.keyPos.map((x) => Math.round((100 * x) / (a.keyPos.reduce((s, y) => s + y, 0) || 1)))
  console.log(
    `${g.label.padEnd(15)} ${pct(a.dup / a.n)} ${pct(a.quoteOK / a.n)}    ${pct(a.deadDistr / (a.distrTot || 1))}      ` +
    `${pct(a.tooEasy / (a.discrimN || 1))}   ${(a.discrimSum / (a.discrimN || 1)).toFixed(3)}   ${kp.join('/')}`
  )
}
console.log('\nkeyPos: uniform is 25/25/25/25. Clustering makes the correct option guessable.')
console.log('discrim: 0 = every model agrees (no signal); higher = separates strong from weak models.')

// --- triviality probe -------------------------------------------------------

if (!wantProbe) {
  console.log('\n(run with --probe to measure triviality: answering with NO source material)')
  process.exit(0)
}

console.log('\n' + '='.repeat(92))
console.log(`TRIVIALITY PROBE — answering with no source (${probeN} questions per generator)`)
console.log('='.repeat(92))

const PROBE_SCHEMA = {
  type: 'object',
  properties: { choice: { type: 'string' }, confidence: { type: 'number' } },
  required: ['choice', 'confidence'],
  additionalProperties: false,
}
// One neutral, capable model for all generators, so the probe measures the
// questions rather than the prober.
const PROBER = { id: 'qwen/qwen3.7-plus', pricePerM: [0.32, 1.28] }

mkdirSync(join(RESULTS_DIR, 'probe'), { recursive: true })
let probeCost = 0

for (const g of GEN_MODELS) {
  const files = readdirSync(QDIR).filter((f) => f.includes(`__${g.label}__`))
  const pool = []
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(QDIR, f), 'utf8'))
    for (const q of j.questions) pool.push({ ...q, subject: j.subject })
  }
  // Deterministic spread across the pool rather than the first N of one file.
  const step = Math.max(1, Math.floor(pool.length / probeN))
  const sample = []
  for (let i = 0; i < pool.length && sample.length < probeN; i += step) sample.push(pool[i])

  const cacheFile = join(RESULTS_DIR, 'probe', `${g.label}.json`)
  let rows
  if (existsSync(cacheFile)) {
    rows = JSON.parse(readFileSync(cacheFile, 'utf8'))
  } else {
    rows = await mapLimit(sample, 5, async (q) => {
      const letters = ['A', 'B', 'C', 'D']
      const r = await chat({
        model: PROBER.id,
        system: 'You answer multiple-choice questions. Respond with JSON only.',
        user: `Answer this multiple-choice question.\n\nQuestion: ${q.question_text}\nOptions:\n${q.options.map((o, i) => `${letters[i]}. ${o.text}`).join('\n')}\n\nRespond with: {"choice": "B", "confidence": 0.0}`,
        maxTokens: 128,
        schema: PROBE_SCHEMA,
        pricePerM: PROBER.pricePerM,
      })
      probeCost += r.cost
      const p = parseJson(r.text)
      const ci = 'ABCD'.indexOf(String(p?.choice ?? '').trim().toUpperCase().slice(0, 1))
      return { correct: ci === q.options.findIndex((o) => o.is_correct), conf: p?.confidence ?? 0 }
    }, { label: `probe/${g.label}` })
    writeFileSync(cacheFile, JSON.stringify(rows))
  }

  const ok = rows.filter((r) => r && !r.__error)
  const trivial = ok.filter((r) => r.correct).length / (ok.length || 1)
  console.log(`${g.label.padEnd(15)} answerable without source: ${pct(trivial)}%  (n=${ok.length})`)
}
console.log(`\nprobe cost: $${probeCost.toFixed(4)}`)
console.log('Lower is better: a question answerable with no source tests general knowledge,')
console.log('not the uploaded course material — the opposite of what an exam-prep app needs.')
