#!/usr/bin/env node
/**
 * Stage 2: embed every chunk with each of the 3 embedding models.
 *
 * Cheap (~$0.05 total) and done once — all 15 downstream (gen x answer) cells
 * under a given embedding model reuse these vectors, so embedding is never
 * re-billed and the retrieval input is identical across them.
 *
 * Usage: node scripts/model-grid/run-embed.mjs [--only <label>]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMBED_MODELS, SUBJECTS, RESULTS_DIR, loadCorpus, loadEnv, mapLimit } from './config.mjs'
import { embed } from './api.mjs'

loadEnv()

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const BATCH = 64   // modest: some providers cap batch size or per-request tokens

async function embedCorpus(model, subject) {
  const out = join(RESULTS_DIR, 'embeddings', `${model.label}__${subject}.json`)
  if (existsSync(out)) {
    console.log(`  ${model.label} / ${subject}: cached`)
    return JSON.parse(readFileSync(out, 'utf8'))
  }

  const { chunks } = loadCorpus(subject)
  const batches = []
  for (let i = 0; i < chunks.length; i += BATCH) batches.push(chunks.slice(i, i + BATCH))

  let tokens = 0
  const results = await mapLimit(
    batches,
    3,
    async (batch) => {
      // Documents get no instruction prefix even on asymmetric models — the
      // prefix belongs on the query side only.
      const r = await embed({ model: model.id, texts: batch.map((c) => c.text), dimensions: model.dimensions })
      tokens += r.tokens
      return r.vectors
    },
    { label: `${model.label}/${subject}` }
  )

  const failed = results.filter((r) => r?.__error)
  if (failed.length) {
    console.error(`  FAILED ${model.label}/${subject}: ${failed[0].__error}`)
    return null
  }

  const vectors = results.flat()
  if (vectors.length !== chunks.length) {
    console.error(`  FAILED ${model.label}/${subject}: got ${vectors.length} vectors for ${chunks.length} chunks`)
    return null
  }

  const payload = {
    model: model.id,
    label: model.label,
    subject,
    dimensions: model.dimensions,
    tokens,
    cost: (tokens * model.pricePerM) / 1e6,
    ids: chunks.map((c) => c.id),
    vectors,
  }
  mkdirSync(join(RESULTS_DIR, 'embeddings'), { recursive: true })
  writeFileSync(out, JSON.stringify(payload))
  console.log(`  ${model.label} / ${subject}: ${vectors.length} vectors, ~${tokens.toLocaleString()} tok, $${payload.cost.toFixed(4)}`)
  return payload
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true })
  let total = 0
  for (const model of EMBED_MODELS) {
    if (only && model.label !== only) continue
    console.log(`\n=== ${model.label} (${model.id}) ===`)
    for (const subject of SUBJECTS) {
      const r = await embedCorpus(model, subject)
      if (r) total += r.cost
    }
  }
  console.log(`\nEmbedding total: $${total.toFixed(4)}`)
}

main()
