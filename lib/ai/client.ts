import { Anthropic } from '@anthropic-ai/sdk'
import { mockMessagesCreate } from './mock'

// Shared model id — change in one place.
export const AI_MODEL = 'claude-sonnet-4-6'

// Minimal shape the lib/ai modules rely on: messages.create returning
// { content: [{ type: 'text', text: string }] }.
export interface AiClient {
  messages: {
    create: (params: any) => Promise<{
      content: Array<{ type: string; text?: string }>
    }>
  }
}

let realClient: Anthropic | null = null

const mockClient: AiClient = {
  messages: {
    create: async (params: any) => mockMessagesCreate(params),
  },
}

/**
 * Returns the Anthropic client, or a token-free mock when MOCK_AI is set.
 *
 * Set MOCK_AI=true (default in tests) to route every call through canned
 * fixtures — no network, no tokens. Set MOCK_AI=false to hit the real API.
 *
 * Checked per-call (not cached) so tests can flip the flag between cases.
 */
export function getClient(): AiClient {
  if (isMockEnabled()) return mockClient
  if (!realClient) realClient = new Anthropic()
  return realClient
}

export function isMockEnabled(): boolean {
  const v = process.env.MOCK_AI
  return v === 'true' || v === '1'
}
