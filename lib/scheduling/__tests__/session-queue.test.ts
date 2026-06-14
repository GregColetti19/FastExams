import { describe, it, expect } from 'vitest'
import { advanceQueue, isSessionComplete, MAX_REQUEUE, QueueState } from '../session-queue'

const start = (ids: string[]): QueueState => ({ queue: ids, requeued: {} })

describe('session queue (repropose with criteria)', () => {
  it('drops a question answered correctly', () => {
    const s = advanceQueue(start(['a', 'b']), true)
    expect(s.queue).toEqual(['b'])
    expect(s.requeued.a ?? 0).toBe(0)
  })

  it('reproposes a wrong answer to the back of the queue', () => {
    const s = advanceQueue(start(['a', 'b']), false)
    expect(s.queue).toEqual(['b', 'a'])
    expect(s.requeued.a).toBe(1)
  })

  it('stops reproposing after MAX_REQUEUE misses', () => {
    let s = start(['a'])
    for (let i = 0; i < MAX_REQUEUE; i++) s = advanceQueue(s, false) // requeues
    expect(s.queue).toEqual(['a'])
    s = advanceQueue(s, false) // over the cap → dropped
    expect(s.queue).toEqual([])
    expect(isSessionComplete(s)).toBe(true)
  })

  it('completes only when the queue empties; wrong-then-right resolves it', () => {
    let s = start(['a', 'b'])
    s = advanceQueue(s, false) // a wrong → ['b','a']
    s = advanceQueue(s, true) // b right → ['a']
    expect(isSessionComplete(s)).toBe(false)
    s = advanceQueue(s, true) // a right → []
    expect(isSessionComplete(s)).toBe(true)
  })

  it('does not mutate the input state', () => {
    const input = start(['a', 'b'])
    advanceQueue(input, false)
    expect(input.queue).toEqual(['a', 'b'])
    expect(input.requeued).toEqual({})
  })
})
