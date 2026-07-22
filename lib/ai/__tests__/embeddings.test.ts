import { describe, it, expect, afterEach, vi } from 'vitest'
import { embedText, embedTexts, cosineSimilarity, EMBED_DIM } from '../embeddings'

describe('embeddings (mock)', () => {
  it('produces vectors of the right dimension', async () => {
    const v = await embedText('hello world testing')
    expect(v).toHaveLength(EMBED_DIM)
  })

  it('ranks lexically-similar text above unrelated text', async () => {
    const [q, related, unrelated] = await embedTexts([
      'Rh isoimmunization in pregnancy requires anti-D immunoglobulin',
      'anti-D immunoglobulin prophylaxis prevents Rh isoimmunization',
      'pyloric stenosis presents with projectile vomiting in infants',
    ])
    const simRelated = cosineSimilarity(q, related)
    const simUnrelated = cosineSimilarity(q, unrelated)
    expect(simRelated).toBeGreaterThan(simUnrelated)
  })

  it('cosine of identical vectors is ~1', async () => {
    const v = await embedText('identical text')
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5)
  })
})

// Real-mode dimension safety (MOCK_AI off, fetch stubbed — no live network).
describe('embeddings dimension guard', () => {
  const saved = { ...process.env }
  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
  })

  it('throws when the provider returns the wrong dimension', async () => {
    process.env.MOCK_AI = 'false'
    process.env.OPENAI_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [1, 2, 3] }] }), // 3 dims, not EMBED_DIM
      text: async () => '',
    })) as unknown as typeof fetch)

    await expect(embedTexts(['x'])).rejects.toThrow(/dim mismatch/)
  })
})
