#!/usr/bin/env node
/**
 * Stage 5: score the grid. Reads results/, writes a report + a divergence file
 * for manual review. No API calls, safe to re-run.
 *
 * Ranking priority (as specified): grounding > consensus > abstention > cost.
 *
 * What each metric does and does not mean:
 * - grounded:  the model's source_quote appears verbatim in the context it was
 *              given. Objective and label-free. Low grounding = the model is
 *              citing from memory rather than the source.
 * - consensus: agreement with the majority of the other answer models on the
 *              same question with the same context. Measures agreement, NOT
 *              correctness — if the field is wrong together, consensus rewards
 *              it. Ranks outliers, does not certify accuracy.
 * - answered:  1 - abstention. Interpreted RELATIVE to the field: answering far
 *              more than everyone else on identical context suggests guessing;
 *              answering far less suggests over-caution.
 * - keyAgree:  agreement with the generating model's own answer key. That key
 *              is a claim, not ground truth, so this is reported but not ranked.
 *
 * Usage: node scripts/model-grid/score.mjs
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EMBED_MODELS, GEN_MODELS, ANSWER_MODELS, SUBJECTS, RESULTS_DIR } from './config.mjs'

const ANS_DIR = join(RESULTS_DIR, 'answers')
if (!existsSync(ANS_DIR)) { console.error('No answers yet — run run-answer.mjs'); process.exit(1) }

const cells = readdirSync(ANS_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ANS_DIR, f), 'utf8')))
const pct = (x) => (x * 100).toFixed(1).padStart(5)

// --- consensus, computed within a prefix -----------------------------------
// Every answer model under one (embed, gen, subject) saw identical questions and
// identical context, so their choices are directly comparable. Across prefixes
// they are not, and are never pooled.

const divergences = []
const consensusByCell = new Map()

for (const embed of EMBED_MODELS) {
  for (const gen of GEN_MODELS) {
    for (const subject of SUBJECTS) {
      const group = cells.filter((c) => c.embedModel === embed.label && c.genModel === gen.label && c.subject === subject)
      if (group.length < 2) continue

      const byQ = new Map()
      for (const cell of group) {
        for (const r of cell.rows) {
          if (!byQ.has(r.qId)) byQ.set(r.qId, [])
          byQ.get(r.qId).push({ model: cell.answerModel, ...r })
        }
      }

      const agree = new Map(group.map((c) => [c.answerModel, { n: 0, hit: 0 }]))
      for (const [qId, answers] of byQ) {
        const voted = answers.filter((a) => a.answerable && a.choiceIdx >= 0)
        if (voted.length < 2) continue
        const tally = {}
        for (const a of voted) tally[a.choiceIdx] = (tally[a.choiceIdx] || 0) + 1
        const top = Math.max(...Object.values(tally))
        const winners = Object.keys(tally).filter((k) => tally[k] === top).map(Number)
        const majority = winners.length === 1 ? winners[0] : null

        for (const a of voted) {
          const s = agree.get(a.model)
          s.n++
          if (majority !== null && a.choiceIdx === majority) s.hit++
        }

        // Unresolved = no clear majority, or a real split. These are what the
        // manual pass should look at; agreement alone can't settle them.
        const unanimous = Object.keys(tally).length === 1
        if (!unanimous) {
          divergences.push({
            prefix: `${embed.label} x ${gen.label} x ${subject}`,
            qId,
            split: Object.entries(tally).map(([c, n]) => `${'ABCD'[c]}:${n}`).join(' '),
            noMajority: majority === null,
            answers: voted.map((a) => ({ model: a.model, choice: 'ABCD'[a.choiceIdx], conf: a.confidence, grounded: a.quoteGrounded })),
            abstained: answers.filter((a) => !a.answerable).map((a) => a.model),
          })
        }
      }
      for (const [model, s] of agree) {
        consensusByCell.set(`${embed.label}|${gen.label}|${model}|${subject}`, s.n ? s.hit / s.n : 0)
      }
    }
  }
}

// --- answer-model ranking ---------------------------------------------------

console.log('='.repeat(96))
console.log('ANSWER MODELS — aggregated over all 9 (embed x gen) prefixes and both subjects')
console.log('='.repeat(96))
console.log('model            grnd%  cons%   ans%   key%   $/q     ms   n')

const answerRows = []
for (const m of ANSWER_MODELS) {
  const mine = cells.filter((c) => c.answerModel === m.label)
  if (!mine.length) continue
  const n = mine.reduce((s, c) => s + c.n, 0)
  const w = (sel) => mine.reduce((s, c) => s + sel(c) * c.n, 0) / (n || 1)
  const cons = mine.reduce((s, c) => s + (consensusByCell.get(`${c.embedModel}|${c.genModel}|${c.answerModel}|${c.subject}`) ?? 0) * c.n, 0) / (n || 1)
  const cost = mine.reduce((s, c) => s + c.cost, 0)
  const row = {
    label: m.label,
    grounded: w((c) => c.groundedRate),
    consensus: cons,
    answered: w((c) => c.answeredRate),
    key: w((c) => c.keyAgreementRate),
    costPerQ: cost / (n || 1),
    latency: w((c) => c.avgLatencyMs),
    n,
    totalCost: cost,
  }
  answerRows.push(row)
}

// Primary sort is grounding, then consensus, then cost — abstention is a
// diagnostic read against the field median rather than a "more is better" axis.
answerRows.sort((a, b) => b.grounded - a.grounded || b.consensus - a.consensus || a.costPerQ - b.costPerQ)
for (const r of answerRows) {
  console.log(
    `${r.label.padEnd(15)} ${pct(r.grounded)} ${pct(r.consensus)} ${pct(r.answered)} ${pct(r.key)} ` +
    `$${r.costPerQ.toFixed(5)} ${String(Math.round(r.latency)).padStart(5)} ${String(r.n).padStart(4)}`
  )
}

const medAnswered = [...answerRows].map((r) => r.answered).sort((a, b) => a - b)[Math.floor(answerRows.length / 2)]
console.log(`\nfield median answered-rate: ${pct(medAnswered)}%  (models far above it on identical context are the guessing suspects)`)

// --- embedding axis ---------------------------------------------------------
// Direct metric: did retrieval actually surface the chunk the question was
// written from? Independent of any answer model.

console.log('\n' + '='.repeat(96))
console.log('EMBEDDING MODELS')
console.log('='.repeat(96))
console.log('model            retrieval-hit%   grnd%(marginal)  cons%(marginal)')
const embedRows = []
for (const e of EMBED_MODELS) {
  const mine = cells.filter((c) => c.embedModel === e.label)
  if (!mine.length) continue
  const n = mine.reduce((s, c) => s + c.n, 0)
  const w = (sel) => mine.reduce((s, c) => s + sel(c) * c.n, 0) / (n || 1)
  embedRows.push({ label: e.label, hit: w((c) => c.retrievalHitRate), grounded: w((c) => c.groundedRate),
    cons: mine.reduce((s, c) => s + (consensusByCell.get(`${c.embedModel}|${c.genModel}|${c.answerModel}|${c.subject}`) ?? 0) * c.n, 0) / (n || 1) })
}
embedRows.sort((a, b) => b.hit - a.hit)
for (const r of embedRows) console.log(`${r.label.padEnd(15)} ${pct(r.hit)}          ${pct(r.grounded)}          ${pct(r.cons)}`)

// --- generation axis --------------------------------------------------------
// Direct metrics come from the questions files: yield (how many usable MCQs out
// of 50) and JSON reliability. Marginal metrics come from how answerable the
// resulting questions turned out to be.

console.log('\n' + '='.repeat(96))
console.log('GENERATION MODELS')
console.log('='.repeat(96))
console.log('model            yield%  malformed  $/50q    ans%(marginal)  grnd%(marginal)')
const QDIR = join(RESULTS_DIR, 'questions')
for (const g of GEN_MODELS) {
  const qs = readdirSync(QDIR).filter((f) => f.includes(`__${g.label}__`)).map((f) => JSON.parse(readFileSync(join(QDIR, f), 'utf8')))
  const mine = cells.filter((c) => c.genModel === g.label)
  const n = mine.reduce((s, c) => s + c.n, 0)
  const w = (sel) => mine.reduce((s, c) => s + sel(c) * c.n, 0) / (n || 1)
  const produced = qs.reduce((s, q) => s + q.produced, 0)
  const requested = qs.reduce((s, q) => s + q.requested, 0)
  const malformed = qs.reduce((s, q) => s + (q.malformedCalls || 0), 0)
  const cost = qs.reduce((s, q) => s + q.cost, 0) / (qs.length || 1)
  console.log(
    `${g.label.padEnd(15)} ${pct(produced / requested)}  ${String(malformed).padStart(6)}     ` +
    `$${cost.toFixed(4)}   ${pct(w((c) => c.answeredRate))}          ${pct(w((c) => c.groundedRate))}`
  )
}

// --- cost -------------------------------------------------------------------

const answerTotal = cells.reduce((s, c) => s + c.cost, 0)
const genTotal = readdirSync(QDIR).reduce((s, f) => s + JSON.parse(readFileSync(join(QDIR, f), 'utf8')).cost, 0)
console.log('\n' + '='.repeat(96))
console.log(`GRID SPEND: answers $${answerTotal.toFixed(2)} + generation $${genTotal.toFixed(2)} + embeddings $0.06 = $${(answerTotal + genTotal + 0.056).toFixed(2)}`)

// --- divergences for manual review -----------------------------------------

const outFile = join(RESULTS_DIR, 'divergences.json')
divergences.sort((a, b) => (b.noMajority ? 1 : 0) - (a.noMajority ? 1 : 0))
writeFileSync(outFile, JSON.stringify(divergences, null, 2))
const noMaj = divergences.filter((d) => d.noMajority).length
console.log(`\nDIVERGENCES: ${divergences.length} questions where models disagreed (${noMaj} with no majority at all)`)
console.log(`  -> ${outFile}`)
console.log('  These are where model quality actually differs. Consensus cannot settle them;')
console.log('  hand-checking this set is what converts the ranking from "agreement" to "accuracy".')
