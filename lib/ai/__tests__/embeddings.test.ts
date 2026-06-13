import { describe, it, expect } from 'vitest'
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
