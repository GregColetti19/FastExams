#!/usr/bin/env node
/**
 * Score the generation evaluation across all corpora. Offline — no API calls.
 *
 * Metrics are pooled question-weighted across corpora, and also broken out per
 * corpus, because subject matter moves several of them a lot (a model that looks
 * strong on one syllabus may not generalise).
 *
 * Tier 1 (decisive)
 *   discrim      correctWithSource - correctNoSource. How much the source
 *                actually helps. The single best label-free signal that a
 *                question tests the uploaded material rather than recall.
 *   trivial%     answered correctly with NO source. Reported as CONTEXT, not as
 *                a defect to minimise: the prober (qwen3.7-plus) has read the
 *                canonical texts for these subjects, so a high value often means
 *                "well-documented material", not "bad question". A student
 *                without the course cannot do what the model does here.
 *   lang%        question language matches corpus language (franc). The Italian
 *                corpus is what makes this metric mean anything.
 *   rawKeyPos    where the GENERATOR put the correct option pre-shuffle.
 *                Production shuffles, so this never reaches students — it only
 *                shows how much de-biasing the model needs.
 *
 * Tier 2 (quality)
 *   rawLenBias%  correct option materially longest BEFORE the equalize pass.
 *   lenBias%     ...and AFTER it. The gap is what the post-process bought.
 *   quoteOK%     generator's own source_quote really appears in the material it
 *                was shown (5-gram, order-sensitive).
 *   deadDistr%   options never chosen by anyone — padding, not distractors.
 *   tooEasy%     correct with source at >= 0.85 confidence.
 *
 * Tier 3: yield, malformed, apiErrors, cost, latency, retrieval.
 *
 * Usage: node scripts/model-grid/gen-eval/score.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
// Default import: this franc build is CommonJS (module.exports = fn), so a
// named `{ franc }` import resolves to undefined. Same note as
// lib/processing/language-detector.ts.
import franc from 'franc'
import { cosine } from '../config.mjs'
import { GEN_MODELS, GE_DATA, GE_RESULTS, CORPORA, N_QUESTIONS, RETRIEVAL_K, EMBED_MODEL } from './config.mjs'

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

const LENGTH_BIAS_RATIO = 1.25
function isLengthBiased(options, correctIdx) {
  const correct = options[correctIdx]
  const wrong = options.filter((_, i) => i !== correctIdx)
  if (!correct || !wrong.length) return false
  if (correct.text.length < Math.max(...wrong.map((o) => o.text.length))) return false
  const meanWrong = wrong.reduce((s, o) => s + o.text.length, 0) / wrong.length
  return meanWrong > 0 && correct.text.length / meanWrong >= LENGTH_BIAS_RATIO
}

/**
 * Retrieval hit-rate, re-graded against the whole synthesis bundle.
 *
 * The value recorded during the run asks "did the SEED chunk land in top-K",
 * which was right when generation saw one chunk. Under synthesis a question
 * legitimately rests on any of the 3 chunks the generator was shown, so seed-only
 * scoring reported a false collapse (78% -> 48%). Here a hit means retrieval
 * surfaced ANY chunk the question was actually built from.
 *
 * Recomputed offline from stored question vectors — no re-run, no cost.
 */
function bundleHitRate(questions, cid, corpus, genLabel) {
  const qvFile = join(GE_RESULTS, 'qvectors', `${genLabel}__${cid}.json`)
  if (!corpus.vectors || !existsSync(qvFile)) return null
  const qVecs = JSON.parse(readFileSync(qvFile, 'utf8'))
  let hit = 0, tot = 0
  questions.forEach((q, qi) => {
    if (!qVecs[qi]) return
    const topK = corpus.vectors
      .map((v, i) => [i, cosine(qVecs[qi], v)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, RETRIEVAL_K)
      .map(([i]) => i)
    const bundle = (q.sourceBundleIds?.length ? q.sourceBundleIds : [q.sourceChunkId])
      .map((id) => corpus.idxById.get(id))
      .filter((i) => i !== undefined)
    tot++
    if (bundle.some((i) => topK.includes(i))) hit++
  })
  return tot ? hit / tot : null
}

// --- load every (generator, corpus) cell ------------------------------------

const corpora = new Map()
for (const C of CORPORA) {
  const f = join(GE_DATA, `corpus-${C.id}.json`)
  if (!existsSync(f)) continue
  const data = JSON.parse(readFileSync(f, 'utf8'))
  const vecFile = join(GE_DATA, `chunkvecs-${C.id}.json`)
  corpora.set(C.id, {
    ...data,
    byId: new Map(data.chunks.map((c) => [c.id, c.text])),
    idxById: new Map(data.chunks.map((c, i) => [c.id, i])),
    vectors: existsSync(vecFile) ? JSON.parse(readFileSync(vecFile, 'utf8')) : null,
    lang: franc(data.chunks.map((c) => c.text).join(' ').slice(0, 20000)),
  })
}

const cells = []
for (const gen of GEN_MODELS) {
  for (const [cid, corpus] of corpora) {
    const qFile = join(GE_RESULTS, 'questions', `${gen.label}__${cid}.json`)
    const aFile = join(GE_RESULTS, 'answers', `${gen.label}__${cid}.json`)
    if (!existsSync(qFile) || !existsSync(aFile)) continue
    const qData = JSON.parse(readFileSync(qFile, 'utf8'))
    const aData = JSON.parse(readFileSync(aFile, 'utf8'))
    const questions = qData.questions
    if (!questions.length) continue
    const ansByQ = new Map(aData.rows.map((r) => [r.qId, r]))
    const n = questions.length

    const rawKeyPos = [0, 0, 0, 0]
    let quoteOK = 0, lenBias = 0, rawLenBias = 0, langOK = 0
    for (const q of questions) {
      if (q.rawCorrectIdx >= 0 && q.rawCorrectIdx < 4) rawKeyPos[q.rawCorrectIdx]++
      // With synthesis the supporting sentence may sit in a neighbour chunk, so
      // check the whole bundle the generator saw, not just the seed.
      const srcIds = q.sourceBundleIds?.length ? q.sourceBundleIds : [q.sourceChunkId]
      const src = srcIds.map((id) => corpus.byId.get(id) || '').join('\n\n')
      if (src && ngramScore(q.source_quote, src) >= 0.5) quoteOK++
      if (isLengthBiased(q.options, q.correctIdx)) lenBias++
      if (q.rawLenBias) rawLenBias++
      // franc is unreliable under ~25 chars; short stems count as OK rather than
      // penalising terse phrasing.
      if (q.question_text.length < 25 || franc(q.question_text) === corpus.lang) langOK++
    }

    const answered = questions.map((q) => ansByQ.get(q.id)).filter(Boolean)
    const an = answered.length || 1
    const withSrc = answered.filter((r) => r.correctWithSource).length / an
    const noSrc = answered.filter((r) => r.correctNoSource).length / an

    let dead = 0, distrTot = 0
    for (const q of questions) {
      const r = ansByQ.get(q.id)
      if (!r) continue
      dead += 4 - new Set([r.choiceIdx, r.probeIdx].filter((i) => i >= 0)).size
      distrTot += 4
    }

    cells.push({
      label: gen.label, corpus: cid, n,
      yield: n / N_QUESTIONS,
      malformed: qData.malformed, apiErrors: qData.apiErrors,
      equalized: qData.equalized ?? 0,
      rawKeyPos,
      trivial: noSrc, withSrc, discrim: withSrc - noSrc,
      lang: langOK / n, quoteOK: quoteOK / n,
      lenBias: lenBias / n, rawLenBias: rawLenBias / n,
      dead: dead / (distrTot || 1),
      tooEasy: answered.filter((r) => r.correctWithSource && r.confidence >= 0.85).length / an,
      retrieval: answered.filter((r) => r.sourceRetrieved).length / an,
      cost: (qData.cost || 0) + (aData.cost || 0),
      genCost: qData.cost || 0,
      latency: qData.avgLatencyMs,
      // Prefer the value recorded during the run; fall back to recomputing from
      // cached question vectors for cells produced before it was recorded.
      retrievalBundle: answered.some((r) => r.bundleRetrieved !== undefined)
        ? answered.filter((r) => r.bundleRetrieved).length / an
        : bundleHitRate(questions, cid, corpus, gen.label),
    })
  }
}

if (!cells.length) { console.log('No results yet — run run.mjs first.'); process.exit(0) }

const pct = (x) => (100 * x).toFixed(1).padStart(5)

/** Question-weighted mean of `sel` over the given cells. */
function wavg(list, sel) {
  const n = list.reduce((s, c) => s + c.n, 0)
  return n ? list.reduce((s, c) => s + sel(c) * c.n, 0) / n : 0
}

const byModel = GEN_MODELS
  .map((g) => ({ label: g.label, cells: cells.filter((c) => c.label === g.label) }))
  .filter((m) => m.cells.length)

const corpusIds = [...new Set(cells.map((c) => c.corpus))]
console.log('='.repeat(104))
console.log(`GENERATION MODELS — pooled over ${corpusIds.length} corpora: ${corpusIds.join(', ')}`)
console.log(`languages: ${corpusIds.map((id) => `${id}=${corpora.get(id).lang}`).join('  ')}`)
console.log('='.repeat(104))

console.log('\nTIER 1 — decisive')
console.log('model            discrim  trivial%  lang%   rawKeyPos A/B/C/D        n')
for (const m of [...byModel].sort((a, b) => wavg(b.cells, (c) => c.discrim) - wavg(a.cells, (c) => c.discrim))) {
  const kp = [0, 1, 2, 3].map((i) => {
    const tot = m.cells.reduce((s, c) => s + c.rawKeyPos.reduce((a, b) => a + b, 0), 0)
    return tot ? Math.round((100 * m.cells.reduce((s, c) => s + c.rawKeyPos[i], 0)) / tot) : 0
  })
  console.log(
    `${m.label.padEnd(15)} ${(100 * wavg(m.cells, (c) => c.discrim)).toFixed(1).padStart(6)}   ` +
    `${pct(wavg(m.cells, (c) => c.trivial))}   ${pct(wavg(m.cells, (c) => c.lang))}   ` +
    `${kp.join('/').padEnd(18)} ${String(m.cells.reduce((s, c) => s + c.n, 0)).padStart(4)}`
  )
}
console.log('  discrim : (correct with source) - (correct without). Higher = the source carries the answer.')
console.log('  trivial%: CONTEXT, not a defect — the prober knows these fields; a student would not.')

console.log('\nTIER 2 — quality')
console.log('model            quoteOK%  rawLenBias%  lenBias%(fixed)  deadDistr%  tooEasy%')
for (const m of [...byModel].sort((a, b) => wavg(b.cells, (c) => c.quoteOK) - wavg(a.cells, (c) => c.quoteOK))) {
  console.log(
    `${m.label.padEnd(15)} ${pct(wavg(m.cells, (c) => c.quoteOK))}     ` +
    `${pct(wavg(m.cells, (c) => c.rawLenBias))}       ${pct(wavg(m.cells, (c) => c.lenBias))}        ` +
    `${pct(wavg(m.cells, (c) => c.dead))}     ${pct(wavg(m.cells, (c) => c.tooEasy))}`
  )
}
console.log('  rawLenBias -> lenBias is what the equalize post-process removed (25% would be unbiased).')

console.log('\nTIER 3 — reliability & cost')
console.log('model            yield%  malformed  apiErr  $/100q   gen-ms  retr(seed)%  retr(bundle)%')
for (const m of [...byModel].sort((a, b) => wavg(b.cells, (c) => c.yield) - wavg(a.cells, (c) => c.yield))) {
  const withBundle = m.cells.filter((c) => c.retrievalBundle !== null)
  console.log(
    `${m.label.padEnd(15)} ${pct(wavg(m.cells, (c) => c.yield))}  ` +
    `${String(m.cells.reduce((s, c) => s + c.malformed, 0)).padStart(6)}  ` +
    `${String(m.cells.reduce((s, c) => s + c.apiErrors, 0)).padStart(6)}  ` +
    `$${(m.cells.reduce((s, c) => s + c.genCost, 0) / m.cells.length).toFixed(4)}  ` +
    `${String(Math.round(wavg(m.cells, (c) => c.latency))).padStart(6)}   ` +
    `${pct(wavg(m.cells, (c) => c.retrieval))}       ` +
    `${withBundle.length ? pct(wavg(withBundle, (c) => c.retrievalBundle)) : '   — '}`
  )
}
console.log('  retr(seed) counts only the seed chunk; retr(bundle) counts any chunk the question was built from.')

console.log('\nPER-CORPUS discrim (higher = better)')
console.log('model            ' + corpusIds.map((c) => c.padEnd(12)).join(''))
for (const m of byModel) {
  const row = corpusIds.map((cid) => {
    const c = m.cells.find((x) => x.corpus === cid)
    return (c ? (100 * c.discrim).toFixed(1) : '—').padEnd(12)
  })
  console.log(`${m.label.padEnd(15)} ${row.join('')}`)
}

console.log('\n' + '='.repeat(104))
console.log(`total spend: $${cells.reduce((s, c) => s + c.cost, 0).toFixed(4)}`)
