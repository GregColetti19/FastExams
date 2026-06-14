import { describe, it, expect } from 'vitest'
import { assertRealConfig } from '@/lib/supabase/mock-mode'

describe('assertRealConfig (fail loud when real DB is misconfigured)', () => {
  it('throws when url/key are missing', () => {
    expect(() => assertRealConfig(undefined, undefined)).toThrowError(/SUPABASE URL\/KEY/i)
  })

  it('throws when values are the .env.example placeholders', () => {
    expect(() => assertRealConfig('your-project-url', 'your-anon-key')).toThrowError(/placeholder/i)
  })

  it('passes for real-looking config', () => {
    expect(() =>
      assertRealConfig('https://abc.supabase.co', 'eyJhbGciOiJ...realkey')
    ).not.toThrow()
  })
})
