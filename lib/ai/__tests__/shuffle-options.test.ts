import { describe, it, expect } from 'vitest'
import { shuffleOptions, hasLengthBias, equalizeOptionLengths } from '../generate-questions'

describe('shuffleOptions', () => {
  it('keeps every option and its is_correct flag intact', () => {
    const options = [
      { text: 'right', is_correct: true },
      { text: 'wrong 1', is_correct: false },
      { text: 'wrong 2', is_correct: false },
      { text: 'wrong 3', is_correct: false },
    ]
    const out = shuffleOptions(options)
    expect(out).toHaveLength(4)
    expect([...out].sort((a, b) => a.text.localeCompare(b.text)))
      .toEqual([...options].sort((a, b) => a.text.localeCompare(b.text)))
    // The key travels with its option — exactly one correct, and it's the same one.
    expect(out.filter((o) => o.is_correct)).toEqual([{ text: 'right', is_correct: true }])
  })

  it('does not mutate the input', () => {
    const options = [
      { text: 'a', is_correct: true },
      { text: 'b', is_correct: false },
    ]
    const snapshot = JSON.parse(JSON.stringify(options))
    shuffleOptions(options)
    expect(options).toEqual(snapshot)
  })

  it('spreads the correct answer across positions', () => {
    // The bug this guards: generators emit the correct option first (measured
    // 100% at position A for gpt-5.6-luna). After shuffling, position must not
    // predict correctness. 400 trials of a 4-option question — a still-biased
    // implementation pins position 0 near 100%, uniform is ~25%.
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < 400; i++) {
      const out = shuffleOptions([
        { text: 'right', is_correct: true },
        { text: 'w1', is_correct: false },
        { text: 'w2', is_correct: false },
        { text: 'w3', is_correct: false },
      ])
      counts[out.findIndex((o) => o.is_correct)]++
    }
    for (const c of counts) {
      expect(c).toBeGreaterThan(50)   // ~100 expected; generous band for flake-freedom
      expect(c).toBeLessThan(150)
    }
  })
})

describe('hasLengthBias', () => {
  const opt = (text: string, is_correct = false) => ({ text, is_correct })

  it('flags a correct option materially longer than the wrong ones', () => {
    expect(hasLengthBias([
      opt('The operator is self-adjoint and compact on the given Hilbert space', true),
      opt('It is unbounded'),
      opt('It is nilpotent'),
      opt('It is singular'),
    ])).toBe(true)
  })

  it('accepts options of comparable length', () => {
    expect(hasLengthBias([
      opt('The operator is self-adjoint', true),
      opt('The operator is unbounded'),
      opt('The operator is nilpotent'),
      opt('The operator is singular'),
    ])).toBe(false)
  })

  it('does not flag when a wrong option is the longest', () => {
    expect(hasLengthBias([
      opt('It is compact', true),
      opt('It is unbounded and fails to be closed on this particular domain'),
      opt('It is nilpotent'),
      opt('It is singular'),
    ])).toBe(false)
  })
})

describe('equalizeOptionLengths', () => {
  // MOCK_AI is on in the test env, so no network call is made.
  it('returns options untouched when there is no bias', async () => {
    const question = {
      question_text: 'Q?',
      justification: 'j',
      options: [
        { text: 'The operator is self-adjoint', is_correct: true },
        { text: 'The operator is unbounded', is_correct: false },
        { text: 'The operator is nilpotent', is_correct: false },
        { text: 'The operator is singular', is_correct: false },
      ],
    }
    // Unbiased input must short-circuit before any model call.
    await expect(equalizeOptionLengths(question)).resolves.toEqual(question.options)
  })

  it('keeps the original options when the rewrite cannot be used', async () => {
    // The mock has no fixture for the rewrite prompt, so the call rejects and
    // the catch returns the originals — a length-biased question beats a lost one.
    const question = {
      question_text: 'Q?',
      justification: 'j',
      options: [
        { text: 'The operator is self-adjoint and compact on the given Hilbert space', is_correct: true },
        { text: 'It is unbounded', is_correct: false },
        { text: 'It is nilpotent', is_correct: false },
        { text: 'It is singular', is_correct: false },
      ],
    }
    const out = await equalizeOptionLengths(question)
    expect(out).toEqual(question.options)
    expect(out.filter((o) => o.is_correct)).toHaveLength(1)
  })
})
