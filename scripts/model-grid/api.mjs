/**
 * Minimal chat + embedding clients for the grid runner.
 *
 * Mirrors lib/ai/client.ts's routing (model id decides provider) but stands
 * alone: these scripts are plain .mjs and the app's modules are TS behind the
 * Next path alias. Kept deliberately small — it only needs the two call shapes
 * the grid uses.
 */
import { callCost } from './config.mjs'

const OPENROUTER = 'https://openrouter.ai/api/v1'
const ANTHROPIC = 'https://api.anthropic.com/v1'

/** Bare 'claude-*' goes direct to Anthropic; vendor-prefixed ids to OpenRouter. */
export const isAnthropic = (model) => /^claude-/.test(model)

function orHeaders() {
  const key = process.env.OPEN_ROUTER_API_KEY
  if (!key) throw new Error('OPEN_ROUTER_API_KEY missing')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': 'https://fastexams.local',
    'X-Title': 'FastExams model grid',
  }
}

/**
 * One chat completion. Returns { text, inTok, outTok, cost, latencyMs, finish }.
 *
 * `schema` (when given) is sent as a strict json_schema response format, so
 * supporting models cannot emit malformed JSON. Non-supporting models ignore it
 * and fall back to the prompt's own "respond with JSON" instruction.
 */
export async function chat({ model, system, user, maxTokens = 2048, schema, pricePerM, mandatoryReasoning = false }) {
  const started = Date.now()

  if (isAnthropic(model)) {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('ANTHROPIC_API_KEY missing (needed for ' + model + ')')
    const res = await fetch(`${ANTHROPIC}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const d = await res.json()
    const inTok = d?.usage?.input_tokens ?? 0
    const outTok = d?.usage?.output_tokens ?? 0
    return {
      text: d?.content?.[0]?.text ?? '',
      inTok, outTok,
      cost: callCost(pricePerM, inTok, outTok),
      latencyMs: Date.now() - started,
      finish: d?.stop_reason ?? '',
    }
  }

  const res = await fetch(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: orHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
      // Output-dominated workload: reasoning bills as output and buys nothing
      // here. Some endpoints (gemini-3.5-flash-lite) reject effort:'none'
      // outright — "Reasoning is mandatory for this endpoint" — so those are
      // flagged in config and sent at minimum effort instead. Their reasoning
      // tokens bill as output, which the measured cost captures.
      ...(mandatoryReasoning ? { reasoning: { effort: 'low' } } : { reasoning: { effort: 'none' } }),
      provider: { data_collection: 'deny' },
      ...(schema
        ? { response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } } }
        : {}),
    }),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`)
  const d = await res.json()
  const choice = d?.choices?.[0]
  const inTok = d?.usage?.prompt_tokens ?? 0
  const outTok = d?.usage?.completion_tokens ?? 0
  return {
    text: choice?.message?.content ?? '',
    inTok, outTok,
    cost: callCost(pricePerM, inTok, outTok),
    latencyMs: Date.now() - started,
    finish: choice?.finish_reason ?? '',
  }
}

/**
 * Embed a batch. All grid models are requested at 1536 dims (native for
 * 3-small, MRL truncation for the others) so vectors stay drop-in compatible
 * with the existing vector(1536) schema.
 */
export async function embed({ model, texts, dimensions = 1536 }) {
  const res = await fetch(`${OPENROUTER}/embeddings`, {
    method: 'POST',
    headers: orHeaders(),
    body: JSON.stringify({ model, input: texts, dimensions }),
  })
  if (!res.ok) throw new Error(`embeddings ${res.status} (${model}): ${(await res.text()).slice(0, 300)}`)
  const d = await res.json()
  const vecs = (d?.data ?? []).map((x) => x.embedding)
  // Fail loudly on a wrong dim rather than silently producing incomparable
  // vectors — a 1024-dim model would otherwise poison every downstream metric.
  if (vecs[0] && vecs[0].length !== dimensions) {
    throw new Error(`dim mismatch: ${model} returned ${vecs[0].length}, expected ${dimensions}`)
  }
  return { vectors: vecs, tokens: d?.usage?.prompt_tokens ?? d?.usage?.total_tokens ?? 0 }
}

/** Strip markdown fences and parse. Returns null instead of throwing. */
export function parseJson(text) {
  if (!text) return null
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // Salvage the outermost {...} — some models prepend prose despite instructions.
    const s = cleaned.indexOf('{')
    const e = cleaned.lastIndexOf('}')
    if (s >= 0 && e > s) {
      try { return JSON.parse(cleaned.slice(s, e + 1)) } catch { return null }
    }
    return null
  }
}
