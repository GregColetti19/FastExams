// Single AI-usage log sink. One function so real telemetry can replace the
// console line later without touching call sites. Both providers' usage objects
// normalise into one shape here.

import type { AiTask } from './client'

export interface AiUsage {
  task: AiTask
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  /** Provider-native stop reason: Anthropic stop_reason / OpenAI finish_reason. */
  finishReason: string
  latencyMs: number
}

/** True when the call stopped by hitting max_tokens — output is likely truncated. */
function isTruncated(finishReason: string): boolean {
  // Anthropic: 'max_tokens'. OpenAI-compat: 'length'.
  return finishReason === 'max_tokens' || finishReason === 'length'
}

/**
 * Emit one structured usage line per non-mock AI call. Warns loudly on
 * truncation: parseJsonResponse throws on invalid JSON and callers swallow it
 * (answer-exam → UNANSWERABLE, extraction → empty list), so a truncated
 * response is silent data loss. Cheaper/more verbose models truncate more.
 */
export function logAiUsage(u: AiUsage): void {
  if (isTruncated(u.finishReason)) {
    console.warn(
      `[ai-usage] TRUNCATED (finish=${u.finishReason}) task=${u.task} model=${u.model} ` +
      `— output likely cut off, JSON parse may fail silently`
    )
  }
  console.log(`[ai-usage] ${JSON.stringify(u)}`)
}
