import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isDevAuthBypass, devUser } from '@/lib/supabase/dev-auth'

// The bypass removes the auth gate, so its OFF-by-default behaviour is the
// safety property worth testing: any missing condition must disable it, and a
// production build must never enable it.
const saved = { ...process.env }

beforeEach(() => {
  delete process.env.DEV_AUTH_BYPASS
  delete process.env.DEV_USER_ID
  delete process.env.DEV_USER_EMAIL
  process.env.NODE_ENV = 'development'
})

afterEach(() => {
  process.env = { ...saved }
})

describe('dev-auth bypass', () => {
  it('is off when nothing is configured', () => {
    expect(isDevAuthBypass()).toBe(false)
    expect(devUser()).toBeNull()
  })

  it('is on only when all three conditions hold', () => {
    process.env.DEV_AUTH_BYPASS = 'true'
    process.env.DEV_USER_ID = 'e761e621-51d1-4281-a177-60f1f50d45e4'
    expect(isDevAuthBypass()).toBe(true)
    expect(devUser()).toEqual({
      id: 'e761e621-51d1-4281-a177-60f1f50d45e4',
      email: 'dev@local',
    })
  })

  it('stays off in a production build even if the flag is set', () => {
    process.env.NODE_ENV = 'production'
    process.env.DEV_AUTH_BYPASS = 'true'
    process.env.DEV_USER_ID = 'e761e621-51d1-4281-a177-60f1f50d45e4'
    expect(isDevAuthBypass()).toBe(false)
    expect(devUser()).toBeNull()
  })

  it('stays off without a user id — a null id would break user-scoped queries', () => {
    process.env.DEV_AUTH_BYPASS = 'true'
    expect(isDevAuthBypass()).toBe(false)
  })

  it('requires the flag to be exactly "true", not any truthy string', () => {
    process.env.DEV_AUTH_BYPASS = '1'
    process.env.DEV_USER_ID = 'e761e621-51d1-4281-a177-60f1f50d45e4'
    expect(isDevAuthBypass()).toBe(false)
  })
})
