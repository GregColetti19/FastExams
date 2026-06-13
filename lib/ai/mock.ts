// Token-free mock responses for the Anthropic client.
//
// Routes each call to a canned fixture by inspecting the system prompt, so the
// whole AI pipeline (topics → questions → flashcards → past-exam → justification)
// runs end-to-end with no network and no tokens. Fixtures echo the requested
// topic/subtopic/language/count so tests can assert the inputs were honored.

type Msg = { content: Array<{ type: string; text: string }> }

function reply(obj: unknown): Msg {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

// --- prompt field extractors --------------------------------------------

function userText(params: any): string {
  const m = params?.messages?.[0]?.content
  if (typeof m === 'string') return m
  if (Array.isArray(m)) {
    const t = m.find((b: any) => b?.type === 'text')
    return t?.text ?? ''
  }
  return ''
}

function hasImage(params: any): boolean {
  const m = params?.messages?.[0]?.content
  return Array.isArray(m) && m.some((b: any) => b?.type === 'image')
}

function grab(text: string, re: RegExp, fallback: string): string {
  const m = text.match(re)
  return m ? m[1].trim() : fallback
}

function grabNum(text: string, re: RegExp, fallback: number): number {
  const m = text.match(re)
  return m ? parseInt(m[1], 10) : fallback
}

// --- fixture builders ----------------------------------------------------

function mockQuestions(n: number, topic: string, subtopic: string) {
  const questions = Array.from({ length: Math.max(1, n) }, (_, i) => ({
    question_text: `[mock] Question ${i + 1} about ${subtopic} (${topic})?`,
    options: [
      { text: `Distractor A for ${subtopic}`, is_correct: false },
      { text: `Correct answer for ${subtopic}`, is_correct: true },
      { text: `Distractor C for ${subtopic}`, is_correct: false },
      { text: `Distractor D for ${subtopic}`, is_correct: false },
    ],
    justification: `[mock] The correct option is right because of ${subtopic}; the others are plausible but wrong.`,
  }))
  return { questions }
}

function mockFlashcards(n: number, subtopic: string) {
  const flashcards = Array.from({ length: Math.max(1, n) }, (_, i) => ({
    front: `[mock] Flashcard ${i + 1}: define a key concept in ${subtopic}`,
    back: `[mock] Concise answer about ${subtopic}.`,
  }))
  return { flashcards }
}

// --- router --------------------------------------------------------------

export function mockMessagesCreate(params: any): Promise<Msg> {
  const system: string = params?.system ?? ''
  const text = userText(params)
  const topic = grab(text, /Topic:\s*(.+)/, 'Mock Topic')
  const subtopic = grab(text, /Subtopic:\s*(.+)/, 'Mock Subtopic')

  // Topic extraction
  if (system.includes('curriculum analyzer')) {
    return Promise.resolve(
      reply({
        topics: [
          { name: 'Cardiovascular System', subtopics: ['Heart Valves', 'Cardiac Cycle', 'Blood Pressure'] },
          { name: 'Respiratory System', subtopics: ['Gas Exchange', 'Lung Mechanics'] },
        ],
      })
    )
  }

  // Image-based question generation (always 2 per blueprint)
  if (system.includes('visual/diagram-based') || hasImage(params)) {
    return Promise.resolve(reply(mockQuestions(2, topic, subtopic)))
  }

  // Text question generation
  if (system.includes('exam question writer')) {
    const n = grabNum(text, /Generate\s+(\d+)\s+multiple choice/, 5)
    return Promise.resolve(reply(mockQuestions(n, topic, subtopic)))
  }

  // Flashcard generation
  if (system.includes('study flashcards')) {
    const n = grabNum(text, /Create\s+(\d+)\s+flashcards/, 3)
    return Promise.resolve(reply(mockFlashcards(n, subtopic)))
  }

  // Past-exam extraction
  if (system.includes('extracting structured question-and-answer')) {
    return Promise.resolve(
      reply({
        year: '2023',
        questions: [
          {
            question_number: '1',
            question_text: '[mock] Which structure separates the left atrium and ventricle?',
            type: 'mcq',
            options: ['A. Tricuspid valve', 'B. Mitral valve', 'C. Aortic valve', 'D. Pulmonary valve'],
            correct_answer: 'B',
            correct_answer_text: 'Mitral valve',
          },
          {
            question_number: '2',
            question_text: '[mock] Define preload.',
            type: 'open',
          },
        ],
      })
    )
  }

  // Past-exam answer determination (grounded in source). The empty-source case
  // is short-circuited before the model call, so the fixture is always answerable.
  if (system.includes('answering exam multiple-choice')) {
    return Promise.resolve(
      reply({
        answerable: true,
        choice: 'B',
        choice_text: 'Mitral valve',
        confidence: 0.85,
        justification: '[mock] The source states the mitral valve separates the left atrium and ventricle.',
        source_quote: '[mock] ...the mitral valve lies between the left atrium and left ventricle...',
      })
    )
  }

  // Justification generation for matched past-exam questions
  if (system.includes('medical educator')) {
    return Promise.resolve(
      reply({
        justification:
          '[mock] The correct answer follows from the matched theory content; each wrong option is ruled out in one line.',
      })
    )
  }

  // Unknown prompt — fail loud so a new prompt shape is noticed in tests.
  return Promise.reject(
    new Error(`mockMessagesCreate: no fixture for system prompt: ${system.slice(0, 80)}`)
  )
}
