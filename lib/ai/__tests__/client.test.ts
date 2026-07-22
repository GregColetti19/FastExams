import { describe, it, expect, afterEach, vi } from 'vitest'
import { getClient, getModelFor, isMockEnabled, AI_MODEL } from '@/lib/ai/client'

describe('AI client mock seam', () => {
  it('is in mock mode under the test runner (zero tokens)', () => {
    expect(isMockEnabled()).toBe(true)
  })

  it('returns a client whose create() never hits the network', async () => {
    const res = await getClient().messages.create({
      system: 'You are an expert academic curriculum analyzer.',
      messages: [{ role: 'user', content: 'outline' }],
    })
    expect(res.content[0].type).toBe('text')
    expect(res.content[0].text).toContain('topics')
  })

  it('rejects an unknown prompt shape so new prompts get noticed', async () => {
    await expect(
      getClient().messages.create({ system: 'totally unknown system', messages: [] })
    ).rejects.toThrow(/no fixture/)
  })

  it('MOCK_AI beats AI_PROVIDER — provider is ignored while mocking', async () => {
    const prev = process.env.AI_PROVIDER
    process.env.AI_PROVIDER = 'openai-compat'
    try {
      // Would throw on a missing key / hit fetch if the provider branch ran;
      // instead it routes to the mock (no network) and returns a canned fixture.
      const res = await getClient().messages.create({
        system: 'You are an expert academic curriculum analyzer.',
        messages: [{ role: 'user', content: 'outline' }],
      })
      expect(res.content[0].text).toContain('topics')
    } finally {
      if (prev === undefined) delete process.env.AI_PROVIDER
      else process.env.AI_PROVIDER = prev
    }
  })
})

describe('getModelFor precedence', () => {
  const saved = { ...process.env }
  afterEach(() => {
    delete process.env.AI_MODEL_ANSWER_DETERMINATION
    delete process.env.AI_MODEL_DEFAULT
    process.env = { ...saved }
  })

  it('falls back to the AI_MODEL constant when nothing is set', () => {
    delete process.env.AI_MODEL_ANSWER_DETERMINATION
    delete process.env.AI_MODEL_DEFAULT
    expect(getModelFor('answer-determination')).toBe(AI_MODEL)
  })

  it('AI_MODEL_DEFAULT overrides the constant', () => {
    delete process.env.AI_MODEL_ANSWER_DETERMINATION
    process.env.AI_MODEL_DEFAULT = 'some/default-model'
    expect(getModelFor('answer-determination')).toBe('some/default-model')
    // Unrelated task also picks up the default.
    expect(getModelFor('question-gen')).toBe('some/default-model')
  })

  it('task-specific env wins over AI_MODEL_DEFAULT', () => {
    process.env.AI_MODEL_DEFAULT = 'some/default-model'
    process.env.AI_MODEL_ANSWER_DETERMINATION = 'some/answer-model'
    expect(getModelFor('answer-determination')).toBe('some/answer-model')
    // Only that task changes; siblings still use the default.
    expect(getModelFor('question-gen')).toBe('some/default-model')
  })
})

// openai-compat adapter: exercised with MOCK_AI off + fetch stubbed, so no live
// network. Verifies system hoisting, response unwrapping, and key resolution.
describe('openai-compat adapter', () => {
  const saved = { ...process.env }
  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  function stubFetch(body: unknown, ok = true, status = 200) {
    const spy = vi.fn(async (_url: string, _init: any) => ({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }))
    vi.stubGlobal('fetch', spy as unknown as typeof fetch)
    return spy
  }

  it('hoists system into messages and unwraps choices[0].message.content', async () => {
    process.env.MOCK_AI = 'false'
    process.env.AI_PROVIDER = 'openai-compat'
    process.env.AI_API_KEY = 'test-key'
    const spy = stubFetch({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    })

    const res = await getClient().messages.create({
      task: 'question-gen',
      model: 'x/y',
      max_tokens: 10,
      system: 'SYS',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(res.content[0]).toEqual({ type: 'text', text: 'hello' })
    const bodyArg = JSON.parse((spy.mock.calls[0][1] as any).body)
    expect(bodyArg.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(bodyArg.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(bodyArg.reasoning).toEqual({ effort: 'none' })
  })

  it('falls back to OPEN_ROUTER_API_KEY when AI_API_KEY is unset', async () => {
    process.env.MOCK_AI = 'false'
    process.env.AI_PROVIDER = 'openai-compat'
    delete process.env.AI_API_KEY
    process.env.OPEN_ROUTER_API_KEY = 'router-key'
    const spy = stubFetch({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {},
    })
    await getClient().messages.create({ task: 'tiebreak', model: 'x/y', max_tokens: 5, system: '', messages: [] })
    expect((spy.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer router-key')
  })

  it('throws a clear error when no key resolves', async () => {
    process.env.MOCK_AI = 'false'
    process.env.AI_PROVIDER = 'openai-compat'
    delete process.env.AI_API_KEY
    delete process.env.OPEN_ROUTER_API_KEY
    await expect(
      getClient().messages.create({ task: 'tiebreak', model: 'x/y', max_tokens: 5, system: '', messages: [] })
    ).rejects.toThrow(/AI_API_KEY is not set/)
  })

  it('warns on truncation (finish_reason=length)', async () => {
    process.env.MOCK_AI = 'false'
    process.env.AI_PROVIDER = 'openai-compat'
    process.env.AI_API_KEY = 'k'
    stubFetch({
      choices: [{ message: { content: '{' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await getClient().messages.create({ task: 'question-gen', model: 'x/y', max_tokens: 1, system: '', messages: [] })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TRUNCATED'))
  })
})
