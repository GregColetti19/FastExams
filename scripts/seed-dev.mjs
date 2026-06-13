#!/usr/bin/env node
// Seed the local mock DB (.dev-data/db.json) with a demo exam so the app shows
// real content in DB_MODE=mock — no cloud, no tokens. Run: npm run dev:seed
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const DB_PATH = process.env.DEV_DB_PATH || '.dev-data/db.json'
const now = () => new Date().toISOString()
const DEV_USER_ID = '00000000-0000-0000-0000-000000000000'

const examId = randomUUID()
const topicId = randomUUID()
const sub1 = randomUUID()
const sub2 = randomUUID()

function mcq(subtopicId, qtext, options, justification, due = false) {
  const id = randomUUID()
  const question = {
    id,
    subtopic_id: subtopicId,
    chunk_id: null,
    question_text: qtext,
    image_storage_path: null,
    justification,
    language: 'en',
    question_type: 'mcq',
    source: 'ai_generated',
    past_exam_year: null,
    matched_chunk_id: null,
    times_seen: 0,
    times_correct: 0,
    current_interval_days: 1,
    last_seen_at: null,
    // Half the questions are already due so /review has content.
    next_review_at: due ? '2020-01-01T00:00:00.000Z' : now(),
    created_at: now(),
  }
  const opts = options.map((o, i) => ({
    id: randomUUID(),
    question_id: id,
    option_text: o.text,
    is_correct: o.correct,
    display_order: i,
  }))
  return { question, opts }
}

const built = [
  mcq(
    sub1,
    'Which valve separates the left atrium from the left ventricle?',
    [
      { text: 'Tricuspid valve', correct: false },
      { text: 'Mitral (bicuspid) valve', correct: true },
      { text: 'Aortic valve', correct: false },
      { text: 'Pulmonary valve', correct: false },
    ],
    'The mitral valve sits between the left atrium and left ventricle. The tricuspid is on the right side; aortic and pulmonary are semilunar outflow valves.',
    true
  ),
  mcq(
    sub1,
    'During which phase do the AV valves close, producing the first heart sound (S1)?',
    [
      { text: 'Isovolumetric contraction', correct: true },
      { text: 'Rapid ventricular filling', correct: false },
      { text: 'Atrial systole', correct: false },
      { text: 'Isovolumetric relaxation', correct: false },
    ],
    'S1 marks the start of systole as the AV (mitral/tricuspid) valves close during isovolumetric contraction.',
    true
  ),
  mcq(
    sub2,
    'Normal resting adult systolic blood pressure is closest to:',
    [
      { text: '60 mmHg', correct: false },
      { text: '120 mmHg', correct: true },
      { text: '200 mmHg', correct: false },
      { text: '40 mmHg', correct: false },
    ],
    'A typical normal resting systolic pressure is around 120 mmHg (120/80).'
  ),
]

const data = {
  tables: {
    profiles: [{ id: DEV_USER_ID, email: 'dev@local', created_at: now() }],
    exams: [
      {
        id: examId,
        user_id: DEV_USER_ID,
        name: 'Cardiology — Demo',
        description: 'Seeded demo exam for local mock mode',
        language: 'en',
        created_at: now(),
        updated_at: now(),
      },
    ],
    topics: [{ id: topicId, exam_id: examId, name: 'Cardiovascular System', display_order: 0, created_at: now() }],
    subtopics: [
      { id: sub1, topic_id: topicId, name: 'Heart Valves & Cycle', display_order: 0, mastery_score: 0, created_at: now() },
      { id: sub2, topic_id: topicId, name: 'Blood Pressure', display_order: 1, mastery_score: 0, created_at: now() },
    ],
    questions: built.map((b) => b.question),
    question_options: built.flatMap((b) => b.opts),
    chunks: [],
    files: [],
    study_sessions: [],
    question_attempts: [],
  },
}

mkdirSync(dirname(DB_PATH), { recursive: true })
writeFileSync(DB_PATH, JSON.stringify(data, null, 2))
console.log(`Seeded ${DB_PATH}`)
console.log(`  1 exam, 1 topic, 2 subtopics, ${data.tables.questions.length} questions (2 due for review)`)
