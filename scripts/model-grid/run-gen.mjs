#!/usr/bin/env node
/**
 * Stage 3: generate 50 MCQs per (embed x gen x subject) cell.
 *
 * Why generation depends on the embedding model: chunks are clustered by their
 * vectors and questions are generated from the resulting groups, so a different
 * embedding model yields different question source material. That dependency is
 * the point — it's what makes the embedding axis measurable downstream rather
 * than just a retrieval-time choice.
 *
 * Each question records the chunk it came from (`sourceChunkId`), which is the
 * ground truth for the retrieval metric in stage 4.
 *
 * Usage: node scripts/model-grid/run-gen.mjs [--only <embedLabel>]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EMBED_MODELS, GEN_MODELS, SUBJECTS, QUESTIONS_PER_SUBJECT,
  RESULTS_DIR, loadCorpus, loadEnv, mapLimit, cosine,
} from './config.mjs'
import { chat, parseJson } from './api.mjs'

loadEnv()

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

// Strict schema: 4 options, exactly one correct. Constrained decoding means a
// supporting model cannot return a malformed or under-specified question.
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
              required: ['text', 'is_correct'],
              additionalProperties: false,
            },
          },
          source_quote: { type: 'string' },
        },
        required: ['question_text', 'options', 'source_quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

const SYSTEM = `You are an expert university examiner. You write exam multiple-choice questions strictly from provided course material.
Always respond with valid JSON only. No preamble, no markdown fences.`

function userPrompt(subjectName, text, n) {
  return `Course: ${subjectName}

Write ${n} multiple-choice exam questions answerable ONLY from the course material below.

Rules:
- Each question must be answerable using the material alone — no outside knowledge.
- Exactly 4 options, exactly one correct.
- Wrong options must be plausible, not absurd — this is a graduate-level exam.
- Do not ask about document structure ("what does section 2 cover"); ask about the subject matter.
- "source_quote" must be a sentence copied VERBATIM from the material that supports the correct answer.
- Write in the same language as the material.

Course material:
${text}

Respond with:
{"questions": [{"question_text": "...", "options": [{"text": "...", "is_correct": true}, {"text": "...", "is_correct": false}, {"text": "...", "is_correct": false}, {"text": "...", "is_correct": false}], "source_quote": "..."}]}`
}

/**
 * Pick which chunks to generate from, spread across the corpus by embedding.
 *
 * Greedy farthest-point selection over the vectors: start from the longest
 * chunk, then repeatedly take the chunk least similar to everything picked so
 * far. This spreads questions over distinct topics instead of clustering them
 * in whichever section happens to be longest — and it makes the choice of
 * embedding model actually influence which material gets examined.
 */
function selectDiverseChunks(chunks, vectors, k) {
  const n = chunks.length
  if (n <= k) return chunks.map((_, i) => i)
  let start = 0
  for (let i = 1; i < n; i++) if (chunks[i].text.length > chunks[start].text.length) start = i
  const picked = [start]
  const maxSim = vectors.map((v) => cosine(v, vectors[start]))
  while (picked.length < k) {
    let best = -1
    let bestSim = Infinity
    for (let i = 0; i < n; i++) {
      if (picked.includes(i)) continue
      if (maxSim[i] < bestSim) { bestSim = maxSim[i]; best = i }
    }
    if (best < 0) break
    picked.push(best)
    for (let i = 0; i < n; i++) maxSim[i] = Math.max(maxSim[i], cosine(vectors[i], vectors[best]))
  }
  return picked
}

const QUESTIONS_PER_CALL = 5

async function runCell(embedModel, genModel, subject) {
  const out = join(RESULTS_DIR, 'questions', `${embedModel.label}__${genModel.label}__${subject}.json`)
  if (existsSync(out)) {
    console.log(`  ${genModel.label} / ${subject}: cached`)
    return JSON.parse(readFileSync(out, 'utf8'))
  }

  const { chunks, name } = loadCorpus(subject)
  const emb = JSON.parse(readFileSync(join(RESULTS_DIR, 'embeddings', `${embedModel.label}__${subject}.json`), 'utf8'))

  const nCalls = Math.ceil(QUESTIONS_PER_SUBJECT / QUESTIONS_PER_CALL)
  const picked = selectDiverseChunks(chunks, emb.vectors, nCalls)

  let cost = 0, inTok = 0, outTok = 0, latency = 0
  // Kept apart on purpose: a model that returns unparseable JSON is a model
  // problem; a call that 429s or 5xxs after retries is an infrastructure
  // problem. Conflating them would charge one model for another's rate limit.
  let malformed = 0, truncated = 0, apiErrors = 0
  const results = await mapLimit(
    picked,
    4,
    async (chunkIdx) => {
      const chunk = chunks[chunkIdx]
      const r = await chat({
        model: genModel.id,
        system: SYSTEM,
        user: userPrompt(name, chunk.text, QUESTIONS_PER_CALL),
        maxTokens: 4096,
        schema: QUESTION_SCHEMA,
        pricePerM: genModel.pricePerM,
        mandatoryReasoning: genModel.mandatoryReasoning,
      })
      cost += r.cost; inTok += r.inTok; outTok += r.outTok; latency += r.latencyMs
      if (r.finish === 'length') truncated++
      const parsed = parseJson(r.text)
      if (!parsed?.questions) { malformed++; return [] }
      return parsed.questions.map((q) => ({ ...q, sourceChunkId: chunk.id, sourceChunkIdx: chunkIdx }))
    },
    { label: `${genModel.label}/${subject}` }
  )
  apiErrors = results.filter((r) => r?.__error).length
  if (apiErrors) console.log(`    (${apiErrors} call(s) failed after retries — not counted against JSON fidelity)`)

  // Keep only well-formed MCQs: 4 options with exactly one correct. A model that
  // emits fewer usable questions is telling us something, so the count is recorded.
  const questions = results
    .filter((r) => Array.isArray(r))
    .flat()
    .filter((q) => q?.question_text && Array.isArray(q.options) && q.options.length === 4 &&
                   q.options.filter((o) => o.is_correct).length === 1)
    .slice(0, QUESTIONS_PER_SUBJECT)
    .map((q, i) => ({ ...q, id: `${subject}:${i}` }))

  const payload = {
    embedModel: embedModel.label, genModel: genModel.label, subject,
    requested: QUESTIONS_PER_SUBJECT, produced: questions.length,
    malformedCalls: malformed, truncatedCalls: truncated, apiErrors,
    cost, inTok, outTok, avgLatencyMs: Math.round(latency / picked.length),
    questions,
  }
  mkdirSync(join(RESULTS_DIR, 'questions'), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2))
  console.log(
    `  ${genModel.label} / ${subject}: ${questions.length}/${QUESTIONS_PER_SUBJECT} questions, ` +
    `$${cost.toFixed(4)}, malformed=${malformed} truncated=${truncated} apiErr=${apiErrors}`
  )
  return payload
}

async function main() {
  let total = 0
  for (const embedModel of EMBED_MODELS) {
    if (only && embedModel.label !== only) continue
    console.log(`\n=== embed: ${embedModel.label} ===`)
    for (const genModel of GEN_MODELS) {
      for (const subject of SUBJECTS) {
        const r = await runCell(embedModel, genModel, subject)
        total += r.cost || 0
      }
    }
  }
  console.log(`\nGeneration total: $${total.toFixed(4)}`)
}

main()
