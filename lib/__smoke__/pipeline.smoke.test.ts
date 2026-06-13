/**
 * End-to-end data-pipeline smoke test (item 0).
 *
 * Drives the REAL pipeline on a REAL Estrelinhas exam PDF to find where it
 * breaks: converter -> chunk -> language -> question extraction.
 *
 * Not run in the normal suite. Run explicitly:
 *   MOCK_AI=false SMOKE=1 ANTHROPIC_API_KEY=... npx vitest run lib/__smoke__
 *
 * Requires the converter service up on CONVERTER_SERVICE_URL (default :8001).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { convertFile } from '@/lib/processing/converter-client'
import { detectLanguage } from '@/lib/processing/language-detector'
import { buildChunks } from '@/lib/processing/chunk-builder'
import { extractPastExamQuestions } from '@/lib/ai/extract-past-exam-questions'
import { answerExamQuestion } from '@/lib/ai/answer-exam-question'

// vitest.config.ts injects MOCK_AI='true' into test env. getClient() reads the
// flag per-call, so flip it back to real here for the smoke run.
if (process.env.SMOKE) {
  process.env.MOCK_AI = 'false'
}

const EXAM_DIR = resolve(__dirname, '../../converter/input_test/past_exams')

function smallestExamPdf(): string {
  const pdfs = readdirSync(EXAM_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => ({ f, size: statSync(resolve(EXAM_DIR, f)).size }))
    .sort((a, b) => a.size - b.size)
  return resolve(EXAM_DIR, pdfs[0].f)
}

function log(stage: string, msg: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[SMOKE ${stage}] ${msg}`)
}

describe.skipIf(!process.env.SMOKE)('pipeline smoke', () => {
  it(
    'convert -> chunk -> language -> extract questions',
    async () => {
      const pdfPath = smallestExamPdf()
      log('0', `exam: ${pdfPath} (${statSync(pdfPath).size} bytes)`)

      // STAGE 1: conversion (PDF -> markdown)
      const buffer = readFileSync(pdfPath)
      let convert
      try {
        convert = await convertFile(buffer, 'pdf')
      } catch (e) {
        log('1 FAIL', `converter error: ${JSON.stringify(e)}`)
        throw e
      }
      const md = convert.markdown
      log(
        '1 OK',
        `converter=${convert.converter_used} markdown=${md.length} chars, images=${convert.images?.length ?? 0}`
      )
      log('1 SAMPLE', md.slice(0, 600).replace(/\n+/g, ' '))
      expect(md.length).toBeGreaterThan(200)

      // STAGE 2: language + chunking
      const lang = detectLanguage(md)
      log('2 lang', `code=${lang.code} (expect pt)`)
      const chunks = buildChunks(md, 'smoke-file', 1, lang.code)
      log('2 chunks', `count=${chunks.length}; first heading="${chunks[0]?.candidateSubtopic ?? ''}"`)

      // STAGE 3: question extraction (REAL AI, bounded to 1 call)
      const slice = md.slice(0, 6000)
      const result = await extractPastExamQuestions(slice, lang.code)
      const qs = result.questions ?? []
      log('3 extract', `year=${result.year ?? '?'} questions=${qs.length}`)
      const withOpts = qs.filter((q) => q.options && q.options.length > 0).length
      const withAns = qs.filter((q) => q.correct_answer || q.correct_answer_text).length
      log('3 quality', `with_options=${withOpts}/${qs.length}  with_answer=${withAns}/${qs.length}`)
      if (qs[0]) {
        log('3 SAMPLE Q', JSON.stringify(qs[0], null, 2))
      }

      expect(qs.length).toBeGreaterThan(0)

      // STAGE 4: answer determination (REAL AI, grounded + flagged)
      // Q1 is about Rh isoimmunization — feed a relevant PT theory snippet.
      const theory =
        'A isoimunização Rh ocorre quando uma grávida Rh negativo é exposta a ' +
        'sangue fetal Rh positivo. A profilaxia com imunoglobulina anti-D é ' +
        'necessária em situações de hemorragia feto-materna, como trauma, ' +
        'cordocentese, gravidez ectópica e aborto. Na mola hidatiforme não há ' +
        'tecido fetal com antigénio D, pelo que não é necessária isoimunização.'
      const ans = await answerExamQuestion(
        qs[0].question_text,
        qs[0].options || [],
        theory,
        lang.code
      )
      log(
        '4 answer',
        `answerable=${ans.answerable} choice=${ans.choice} conf=${ans.confidence}`
      )
      log('4 cite', `quote="${ans.sourceQuote.slice(0, 120)}"`)
      log('4 justif', ans.justification.slice(0, 200))
      expect(ans.answerable).toBe(true)
      expect(ans.choice.length).toBeGreaterThan(0)
      expect(ans.sourceQuote.length).toBeGreaterThan(0)
    },
    180_000
  )
})
