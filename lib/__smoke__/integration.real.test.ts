/**
 * Full real-data integration run with heavy per-stage instrumentation.
 *
 * Drives the WHOLE pipeline on real PDFs with real services so breakages show
 * exactly which stage failed: converter -> chunk -> embed (OpenAI) -> topics
 * (Claude) -> past-exam extract (Claude) -> embedding retrieval -> answer
 * (Claude). Cost-bounded by sampling theory chunks + questions.
 *
 * Run:
 *   SMOKE=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
 *     npx vitest run lib/__smoke__/integration.real.test.ts
 * Converter must be up on :8001.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { convertFile } from '@/lib/processing/converter-client'
import { detectLanguage } from '@/lib/processing/language-detector'
import { buildChunks, splitChunksByTokens } from '@/lib/processing/chunk-builder'
import { embedTexts, cosineSimilarity } from '@/lib/ai/embeddings'
import { extractTopicHierarchy } from '@/lib/ai/extract-topics'
import { assignChunksToSubtopics } from '@/lib/ai/assign-subtopics'
import { extractPastExamQuestions } from '@/lib/ai/extract-past-exam-questions'
import { findBestChunkByEmbedding } from '@/lib/ai/match-to-theory'
import { answerExamQuestion } from '@/lib/ai/answer-exam-question'

// Hit the real APIs (vitest.config injects MOCK_AI=true; flip it back).
if (process.env.SMOKE) process.env.MOCK_AI = 'false'

const INPUT = resolve(__dirname, '../../converter/input_test')
const THEORY_PDF = resolve(INPUT, 'theorical_material/DNS_compressed.pdf')
const THEORY_SAMPLE = 400 // embed (nearly) all theory chunks so retrieval can span domains
const Q_SAMPLE = 5 // past-exam questions (highest-match) to fully answer

function log(stage: string, msg: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[INT ${stage}] ${msg}`)
}

/** Run a stage with timing + failure isolation. */
async function stage<T>(n: string, label: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = Date.now()
  log(n, `→ ${label}`)
  try {
    const out = await fn()
    log(n, `✓ ${label} (${Date.now() - t0}ms)`)
    return out
  } catch (e) {
    log(`${n} FAIL`, `✗ ${label}: ${e instanceof Error ? e.message : JSON.stringify(e)}`)
    if (e instanceof Error && e.stack) console.log(e.stack)
    throw e
  }
}

function smallestExamPdf(): string {
  const dir = resolve(INPUT, 'past_exams')
  const pdfs = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => ({ f, size: statSync(resolve(dir, f)).size }))
    .sort((a, b) => a.size - b.size)
  return resolve(dir, pdfs[0].f)
}

describe.skipIf(!process.env.SMOKE)('real integration', () => {
  it(
    'theory ingest + past-exam grounding on real data',
    async () => {
      // ---- THEORY SIDE -------------------------------------------------
      const theoryMd = await stage('1', 'convert theory PDF', async () => {
        const r = await convertFile(readFileSync(THEORY_PDF), 'pdf')
        log('1', `converter=${r.converter_used} markdown=${r.markdown.length} chars`)
        return r.markdown
      })
      expect(theoryMd.length).toBeGreaterThan(500)

      const theoryLang = await stage('2', 'detect theory language', () => {
        const l = detectLanguage(theoryMd)
        log('2', `lang=${l.code}`)
        return l
      })

      const sampleChunks = await stage('3', 'chunk theory', () => {
        const all = splitChunksByTokens(
          buildChunks(theoryMd, 'theory-file', 1, theoryLang.code),
          500
        )
        const sample = all.filter((c) => c.text.trim().length > 40).slice(0, THEORY_SAMPLE)
        log('3', `total chunks=${all.length}; using ${sample.length} for grounding`)
        sample.slice(0, 5).forEach((c, i) =>
          log('3', `  chunk[${i}] heading="${c.candidateSubtopic ?? ''}" len=${c.text.length}`)
        )
        return sample
      })
      expect(sampleChunks.length).toBeGreaterThan(0)

      const theoryVecs = await stage('4', 'embed theory chunks (OpenAI)', async () => {
        const vecs = await embedTexts(sampleChunks.map((c) => c.text))
        log('4', `embedded=${vecs.length} dim=${vecs[0]?.length}`)
        return vecs
      })
      expect(theoryVecs[0]?.length).toBe(1536)

      await stage('5', 'build tree + assign chunks (Claude + embeddings)', async () => {
        // Stratified content sample → content-grounded tree with descriptions.
        const step = sampleChunks.length / 12
        const sample = Array.from({ length: Math.min(12, sampleChunks.length) }, (_, i) =>
          sampleChunks[Math.floor(i * step)].text
        )
        const hierarchy = await extractTopicHierarchy(sample, theoryLang.code)
        const flat = hierarchy.topics.flatMap((t) =>
          (t.subtopics || []).map((s) => ({ topic: t.name, name: s.name, description: s.description }))
        )
        for (const t of hierarchy.topics) {
          log('5', `topic="${t.name}" subtopics=[${(t.subtopics || []).map((s) => s.name).join(', ')}]`)
        }
        expect(flat.length).toBeGreaterThan(0)

        // Seed from descriptions, assign all chunks, report the distribution.
        const descVecs = await embedTexts(flat.map((s) => s.description))
        const subSeeds = flat.map((s, i) => ({ topic: s.topic, name: s.name, embedding: descVecs[i] }))
        const chunkVecs = sampleChunks.map((_, i) => ({ id: String(i), embedding: theoryVecs[i] }))
        const assignments = assignChunksToSubtopics(chunkVecs, subSeeds)

        const dist = new Map<string, number>()
        let unconfident = 0
        for (const a of assignments) {
          if (!a.confident) unconfident++
          const k = a.subtopic || '(none)'
          dist.set(k, (dist.get(k) || 0) + 1)
        }
        log('5', `assigned ${assignments.length} chunks; unconfident=${unconfident}`)
        for (const [name, cnt] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
          log('5', `  ${cnt} → ${name}`)
        }
        // Chunks should spread across subtopics, not collapse to one.
        expect(dist.size).toBeGreaterThan(1)
      })

      // Grounding candidates: real embeddings + a per-chunk pseudo-subtopic.
      const candidates = sampleChunks.map((c, i) => ({
        id: String(i),
        subtopicId: c.candidateSubtopic || `chunk-${i}`,
        embedding: theoryVecs[i],
      }))

      // ---- PAST-EXAM SIDE ----------------------------------------------
      const examPath = smallestExamPdf()
      const examMd = await stage('6', `convert past exam (${examPath.split('/').pop()})`, async () => {
        const r = await convertFile(readFileSync(examPath), 'pdf')
        log('6', `markdown=${r.markdown.length} chars`)
        return r.markdown
      })
      const examLang = detectLanguage(examMd)

      const questions = await stage('7', 'extract exam questions (Claude)', async () => {
        const r = await extractPastExamQuestions(examMd.slice(0, 6000), examLang.code)
        const qs = (r.questions || []).filter((q) => q.type === 'mcq')
        log('7', `year=${r.year ?? '?'} mcq=${qs.length}`)
        return qs
      })
      expect(questions.length).toBeGreaterThan(0)

      // Embed ALL questions, rank by best theory match, answer the top ones —
      // those are where grounding actually exists, exercising the happy path.
      const ranked = await stage('8', 'embed + rank all questions (OpenAI)', async () => {
        const qVecs = await embedTexts(questions.map((q) => q.question_text))
        const r = questions
          .map((q, i) => ({ q, match: findBestChunkByEmbedding(qVecs[i], candidates) }))
          .sort((a, b) => b.match.score - a.match.score)
        log('8', `embedded ${questions.length}; top scores: ${r.slice(0, Q_SAMPLE).map((x) => x.match.score.toFixed(2)).join(', ')}`)
        return r
      })

      // ---- RETRIEVAL + ANSWER (top matches) ----------------------------
      let answered = 0
      let confSum = 0
      const top = ranked.slice(0, Q_SAMPLE)
      for (let k = 0; k < top.length; k++) {
        const { q, match } = top[k]
        await stage(`9.${k}`, `answer best-match Q${q.question_number} (score=${match.score.toFixed(3)})`, async () => {
          const matchedChunk = sampleChunks[Number(match.chunkId)]
          log(`9.${k}`, `Q: ${q.question_text.slice(0, 100)}`)
          log(`9.${k}`, `theory: ${(matchedChunk?.text || '').slice(0, 120).replace(/\n/g, ' ')}`)

          const ans = await answerExamQuestion(
            q.question_text,
            q.options || [],
            matchedChunk?.text || '',
            examLang.code
          )
          log(`9.${k}`, `answerable=${ans.answerable} choice=${ans.choice} conf=${ans.confidence}`)
          if (ans.answerable) {
            answered++
            confSum += ans.confidence
            log(`9.${k}`, `cite: "${ans.sourceQuote.slice(0, 100)}"`)
          } else {
            log(`9.${k}`, `FLAGGED unanswerable (grounding insufficient)`)
          }
        })
      }

      log(
        'SUMMARY',
        `top-${top.length} questions: answered=${answered} flagged=${top.length - answered}` +
          ` avgConf=${answered ? (confSum / answered).toFixed(2) : 'n/a'}`
      )
    },
    600_000
  )
})
