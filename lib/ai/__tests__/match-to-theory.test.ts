import { describe, it, expect } from 'vitest'
import {
  scoreChunkMatch,
  findBestMatchingChunk,
  generateJustification,
} from '@/lib/ai/match-to-theory'

describe('scoreChunkMatch (pure keyword overlap)', () => {
  it('scores full overlap as 1', () => {
    expect(scoreChunkMatch('mitral valve heart', 'the mitral valve in the heart')).toBe(1)
  })

  it('scores zero overlap as 0', () => {
    expect(scoreChunkMatch('quantum physics', 'baking bread recipes')).toBe(0)
  })

  it('ignores short words (<=3 chars)', () => {
    // only "valve" (>3) counts; it matches → score 1
    expect(scoreChunkMatch('a an the valve', 'valve here')).toBe(1)
  })

  it('returns 0 when either side is empty', () => {
    expect(scoreChunkMatch('', 'anything long enough')).toBe(0)
    expect(scoreChunkMatch('anything long enough', '')).toBe(0)
  })
})

describe('findBestMatchingChunk', () => {
  it('picks the chunk with the highest overlap', () => {
    const chunks = [
      { id: 'c1', text: 'respiratory gas exchange alveoli', subtopicId: 's1' },
      { id: 'c2', text: 'mitral valve cardiac cycle heart', subtopicId: 's2' },
    ]
    const best = findBestMatchingChunk('mitral valve disease', chunks)
    expect(best.chunkId).toBe('c2')
    expect(best.subtopicId).toBe('s2')
    expect(best.score).toBeGreaterThan(0)
  })

  it('falls back to the first chunk when nothing matches', () => {
    const chunks = [
      { id: 'c1', text: 'aaaa bbbb', subtopicId: 's1' },
      { id: 'c2', text: 'cccc dddd', subtopicId: 's2' },
    ]
    const best = findBestMatchingChunk('zzzz yyyy', chunks)
    expect(best.chunkId).toBe('c1')
    expect(best.score).toBe(0)
  })
})

describe('generateJustification (mocked AI)', () => {
  it('returns a non-empty justification string', async () => {
    const j = await generateJustification('Q?', 'B', ['A', 'C', 'D'], 'theory content', 'en')
    expect(typeof j).toBe('string')
    expect(j.length).toBeGreaterThan(0)
  })
})
