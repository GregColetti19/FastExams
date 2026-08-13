import { Anthropic } from '@anthropic-ai/sdk'
import { mockMessagesCreate } from './mock'
import { logAiUsage } from './usage'

// Shared model id — the final fallback in getModelFor(). Kept exported because
// tests and other code import it directly.
export const AI_MODEL = 'claude-sonnet-4-6'

// Per-task model resolution. Every AI call site names its task; getModelFor
// resolves task-specific env → AI_MODEL_DEFAULT → the AI_MODEL constant. This is
// the seam for later per-task model tiering — no call site hardcodes a model.
export type AiTask =
  | 'topic-hierarchy'
  | 'topic-extraction'
  | 'tiebreak'
  | 'question-gen'
  | 'flashcard-gen'
  | 'past-exam-extraction'
  | 'answer-determination'
  | 'justification'

const TASK_ENV: Record<AiTask, string> = {
  'topic-hierarchy': 'AI_MODEL_TOPIC_HIERARCHY',
  'topic-extraction': 'AI_MODEL_TOPIC_EXTRACTION',
  tiebreak: 'AI_MODEL_TIEBREAK',
  'question-gen': 'AI_MODEL_QUESTION_GEN',
  'flashcard-gen': 'AI_MODEL_FLASHCARD_GEN',
  'past-exam-extraction': 'AI_MODEL_PAST_EXAM_EXTRACTION',
  'answer-determination': 'AI_MODEL_ANSWER_DETERMINATION',
  justification: 'AI_MODEL_JUSTIFICATION',
}

export function getModelFor(task: AiTask): string {
  return process.env[TASK_ENV[task]] || process.env.AI_MODEL_DEFAULT || AI_MODEL
}

// Minimal shape the lib/ai modules rely on: messages.create returning
// { content: [{ type: 'text', text: string }] }. Call sites additionally pass a
// `task` field (used only for usage logging; stripped before the API call).
export interface AiClient {
  messages: {
    create: (params: any) => Promise<{
      content: Array<{ type: string; text?: string }>
    }>
  }
}

/**
 * Which provider serves a given model.
 *
 * AI_PROVIDER, when set, forces every call down one path (previous behaviour).
 * When unset, the model id decides: Anthropic ids ('claude-sonnet-5',
 * 'anthropic/claude-sonnet-5') go to the Anthropic SDK on ANTHROPIC_API_KEY;
 * anything namespaced for a gateway ('qwen/...', 'openai/...') goes to the
 * openai-compat path. This lets one run mix providers — required for per-task
 * tiering across vendors, and for eval grids that pit them against each other.
 */
function providerName(model?: string): string {
  const forced = process.env.AI_PROVIDER
  if (forced === 'openai-compat') return 'openai-compat'
  if (forced === 'anthropic') return 'anthropic'
  if (model) {
    // Bare 'claude-*' is Anthropic's own id form; 'anthropic/*' is the gateway form.
    if (/^claude-/.test(model)) return 'anthropic'
    if (model.includes('/')) return 'openai-compat'
  }
  return 'anthropic'
}

/**
 * Models that reject `reasoning: { effort: 'none' }` and must be sent a real
 * effort level. Defaults to the one endpoint known to 400 on it
 * (gemini-3.5-flash-lite, verified 2026-08-12); override with a comma-separated
 * substring list in AI_REASONING_MANDATORY as other providers follow suit.
 */
function reasoningMandatory(model: string): boolean {
  const list = (process.env.AI_REASONING_MANDATORY ?? 'gemini-3.5-flash-lite')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.some((frag) => model.includes(frag))
}

/** Gateway ids carry a vendor prefix the Anthropic SDK doesn't accept — strip it. */
function stripVendorPrefix(model: string): string {
  return model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model
}

// --- Anthropic (default) ----------------------------------------------------

let anthropicSdk: Anthropic | null = null

const anthropicClient: AiClient = {
  messages: {
    create: async (params: any) => {
      // `schema` is the provider-agnostic structured-output hint; the Anthropic
      // path doesn't take response_format, so drop it (prompts already ask for
      // JSON, and parseJsonResponse still guards).
      const { task, schema: _schema, ...rest } = params
      const apiParams = { ...rest, model: stripVendorPrefix(rest.model) }
      if (!anthropicSdk) anthropicSdk = new Anthropic()
      const started = Date.now()
      const message: any = await anthropicSdk.messages.create(apiParams)
      logAiUsage({
        task: task ?? 'question-gen',
        model: apiParams.model,
        provider: 'anthropic',
        inputTokens: message?.usage?.input_tokens ?? 0,
        outputTokens: message?.usage?.output_tokens ?? 0,
        finishReason: message?.stop_reason ?? '',
        latencyMs: Date.now() - started,
      })
      return message
    },
  },
}

// --- OpenAI-compatible (OpenRouter etc.) via raw fetch, no new SDK dep -------
//
// Translates the Anthropic-shaped contract into the OpenAI /chat/completions
// shape and back: top-level `system` string is hoisted to a leading system
// message; the plain-string `choices[0].message.content` is re-wrapped as
// { content: [{ type:'text', text }] } so every call site is unchanged.

function resolveChatKey(): string {
  // AI_API_KEY → OPEN_ROUTER_API_KEY (note underscore spelling — already in env).
  const key = process.env.AI_API_KEY || process.env.OPEN_ROUTER_API_KEY
  if (!key) {
    throw new Error(
      'AI_API_KEY is not set (needed for AI_PROVIDER=openai-compat; ' +
      'falls back to OPEN_ROUTER_API_KEY)'
    )
  }
  return key
}

function resolveChatBaseUrl(): string {
  // Default to OpenRouter only for openai-compat; never override Anthropic.
  return process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1'
}

const openaiCompatClient: AiClient = {
  messages: {
    create: async (params: any) => {
      const { task, model, max_tokens, system, messages, schema } = params
      const key = resolveChatKey()
      const baseUrl = resolveChatBaseUrl()

      const outMessages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...(messages ?? []),
      ]

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      }
      // Optional OpenRouter attribution headers (per docs: HTTP-Referer, X-Title).
      if (process.env.AI_HTTP_REFERER) headers['HTTP-Referer'] = process.env.AI_HTTP_REFERER
      if (process.env.AI_APP_TITLE) headers['X-Title'] = process.env.AI_APP_TITLE

      const started = Date.now()
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          max_tokens,
          messages: outMessages,
          // Schema-constrained decoding when the call site supplies one: the
          // model *cannot* emit non-conforming JSON, so malformed output stops
          // being a failure mode instead of something to detect after the fact.
          // Models without structured-output support ignore this and fall back
          // to prompt-instructed JSON + parseJsonResponse.
          ...(schema
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'result', strict: true, schema },
                },
              }
            : {}),
          // Reasoning bills as output and this workload is output-dominated, so
          // disable it. Per OpenRouter docs, effort:'none' disables reasoning
          // entirely (unlike exclude, which keeps reasoning but hides it).
          //
          // Some endpoints refuse: google/gemini-3.5-flash-lite 400s with
          // "Reasoning is mandatory for this endpoint and cannot be disabled."
          // Those models are listed in AI_REASONING_MANDATORY (comma-separated
          // substrings) and get minimum effort instead of none, so they are
          // usable via AI_MODEL_* at all. Their reasoning tokens bill as output.
          reasoning: { effort: reasoningMandatory(model) ? 'low' : 'none' },
          // Don't route to providers that retain inputs for training.
          provider: { data_collection: 'deny' },
        }),
      })
      if (!res.ok) {
        throw new Error(`AI provider ${res.status} (${baseUrl}): ${await res.text()}`)
      }
      const data: any = await res.json()
      const choice = data?.choices?.[0]
      const text = choice?.message?.content ?? ''

      logAiUsage({
        task: task ?? 'question-gen',
        model,
        provider: 'openai-compat',
        inputTokens: data?.usage?.prompt_tokens ?? 0,
        outputTokens: data?.usage?.completion_tokens ?? 0,
        finishReason: choice?.finish_reason ?? '',
        latencyMs: Date.now() - started,
      })

      return { content: [{ type: 'text', text }] }
    },
  },
}

// --- mock (token-free) ------------------------------------------------------

const mockClient: AiClient = {
  messages: {
    // Strip `task` (mock fixtures key off system/user, not task) before dispatch.
    create: async (params: any) => {
      const { task: _task, ...apiParams } = params
      return mockMessagesCreate(apiParams)
    },
  },
}

/**
 * Returns the active AI client.
 *
 * MOCK_AI takes absolute precedence (checked per-call, not cached, so tests can
 * flip it between cases). Otherwise AI_PROVIDER forces a path when set; when it
 * is unset the `model` id routes (see providerName). Pass the same model id you
 * will pass to messages.create, or omit it to get the Anthropic default.
 * The Anthropic path uses the SDK's own ANTHROPIC_API_KEY.
 */
export function getClient(model?: string): AiClient {
  if (isMockEnabled()) return mockClient
  if (providerName(model) === 'openai-compat') return openaiCompatClient
  return anthropicClient
}

export function isMockEnabled(): boolean {
  const v = process.env.MOCK_AI
  return v === 'true' || v === '1'
}
