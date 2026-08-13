#!/usr/bin/env node
/**
 * Pre-flight: one tiny call to every model in the grid.
 *
 * Costs well under a cent and catches the failures that would otherwise surface
 * an hour into a paid run: a wrong/renamed model id, a provider that rejects the
 * key, an embedding model that ignores `dimensions` and returns a dim the
 * vector(1536) schema can't take, or a chat model that ignores json_schema.
 *
 * Usage: node scripts/model-grid/smoke.mjs
 */
import { EMBED_MODELS, GEN_MODELS, ANSWER_MODELS, loadEnv } from './config.mjs'
import { chat, embed, parseJson, isAnthropic } from './api.mjs'

loadEnv()

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, word: { type: 'string' } },
  required: ['ok', 'word'],
  additionalProperties: false,
}

let fail = 0

async function checkChat(m, kind) {
  try {
    const r = await chat({
      model: m.id,
      system: 'Respond with JSON only.',
      user: 'Return {"ok": true, "word": "pong"}',
      maxTokens: 64,
      schema: isAnthropic(m.id) ? undefined : SCHEMA,
      pricePerM: m.pricePerM,
      mandatoryReasoning: m.mandatoryReasoning,
    })
    const parsed = parseJson(r.text)
    const jsonOk = parsed && parsed.ok === true
    console.log(
      `  ${jsonOk ? 'OK  ' : 'WARN'} ${m.label.padEnd(16)} ${kind}  ` +
      `${String(r.latencyMs).padStart(6)}ms  in=${r.inTok} out=${r.outTok} $${r.cost.toFixed(6)}` +
      (jsonOk ? '' : `  <- JSON not conforming: ${JSON.stringify(r.text).slice(0, 80)}`)
    )
    if (!jsonOk) fail++
  } catch (e) {
    console.log(`  FAIL ${m.label.padEnd(16)} ${kind}  ${String(e.message).slice(0, 160)}`)
    fail++
  }
}

async function checkEmbed(m) {
  try {
    const r = await embed({ model: m.id, texts: ['hello world'], dimensions: m.dimensions })
    const dim = r.vectors[0]?.length
    const ok = dim === m.dimensions
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${m.label.padEnd(16)} embed  dim=${dim} (want ${m.dimensions}) tokens=${r.tokens}`)
    if (!ok) fail++
  } catch (e) {
    console.log(`  FAIL ${m.label.padEnd(16)} embed  ${String(e.message).slice(0, 160)}`)
    fail++
  }
}

async function main() {
  console.log('=== embedding models ===')
  for (const m of EMBED_MODELS) await checkEmbed(m)

  console.log('\n=== generation models ===')
  for (const m of GEN_MODELS) await checkChat(m, 'gen   ')

  console.log('\n=== answer models ===')
  for (const m of ANSWER_MODELS) await checkChat(m, 'answer')

  console.log(fail === 0 ? '\nAll models reachable.' : `\n${fail} problem(s) — fix before running the grid.`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
