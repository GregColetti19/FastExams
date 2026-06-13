import { describe, it, expect } from 'vitest'
import { getClient, isMockEnabled } from '@/lib/ai/client'

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
})
