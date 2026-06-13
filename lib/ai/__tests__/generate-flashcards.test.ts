import { describe, it, expect } from 'vitest'
import {
  generateFlashcardsFromText,
  generateFlashcardsFromChunks,
} from '@/lib/ai/generate-flashcards'

describe('generateFlashcardsFromText (mocked AI)', () => {
  it('returns the requested number of front/back cards', async () => {
    const cards = await generateFlashcardsFromText('content', 'Cardio', 'Heart', 'en', 4)
    expect(cards).toHaveLength(4)
    for (const c of cards) {
      expect(typeof c.front).toBe('string')
      expect(typeof c.back).toBe('string')
      expect(c.front.length).toBeGreaterThan(0)
    }
  })
})

describe('generateFlashcardsFromChunks (mocked AI)', () => {
  it('produces 3 cards per chunk', async () => {
    const cards = await generateFlashcardsFromChunks(
      [{ text: 'a' }, { text: 'b' }],
      'Cardio',
      'Heart',
      'en'
    )
    expect(cards).toHaveLength(6)
  })
})
