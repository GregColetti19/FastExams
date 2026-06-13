import { describe, it, expect } from 'vitest'
import { extractTopics, buildOutlineFromChunks } from '@/lib/ai/extract-topics'

describe('extractTopics (mocked AI)', () => {
  it('returns a topic→subtopic tree', async () => {
    const result = await extractTopics('Heart\nLungs', 'en', 'medicine')
    expect(result.topics.length).toBeGreaterThan(0)
    for (const t of result.topics) {
      expect(typeof t.name).toBe('string')
      expect(Array.isArray(t.subtopics)).toBe(true)
      expect(t.subtopics.length).toBeGreaterThan(0)
    }
  })
})

describe('buildOutlineFromChunks', () => {
  it('joins non-empty headings with a bullet separator', () => {
    expect(buildOutlineFromChunks(['A', '', 'B'])).toBe('A\n- B')
  })

  it('returns empty string for no headings', () => {
    expect(buildOutlineFromChunks([])).toBe('')
  })
})
