import { NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { embedTexts, isEmbedMockEnabled } from '@/lib/ai/embeddings'
import { findBestChunkByEmbedding, matchChunkForQuestion } from '@/lib/ai/match-to-theory'
import { answerExamQuestion } from '@/lib/ai/answer-exam-question'

const EMBED_MATCH_MIN_SCORE = 0.25
const ANSWER_MIN_CONFIDENCE = 0.4

function optionLetter(optionText: string): string {
  const m = optionText.match(/^\s*([A-Za-z])/)
  return m ? m[1].toUpperCase() : ''
}

/**
 * Re-ground past-exam questions that were previously unanswerable or low-confidence.
 * Called after new theory material is added to an exam so the expanded chunk pool
 * can resolve questions the original theory couldn't ground.
 */
/**
 * Re-ground previously-unanswerable past-exam questions against the expanded
 * chunk pool. In lib so generate-exam can run it in-process — a self-fetch to
 * our own /api endpoint 404s. See lib/ai/generate-questions-run.ts.
 */
export async function runRecalibrate(request: Request): Promise<Response> {
  try {
    const { examId } = await request.json()
    if (!examId) {
      return NextResponse.json({ error: 'examId required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = await createServerClient_() as any

    const { data: exam } = await supabase.from('exams').select('*').eq('id', examId).single()
    if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 404 })

    // Collect subtopic IDs that belong to this exam (two-step, no FK-join engine).
    const { data: topics } = await supabase.from('topics').select('id').eq('exam_id', examId)
    const topicIds = (topics || []).map((t: any) => t.id)
    if (topicIds.length === 0) return NextResponse.json({ recalibrated: 0, stillUnanswerable: 0 })

    const { data: subtopics } = await supabase.from('subtopics').select('id').in('topic_id', topicIds)
    const subtopicIds = (subtopics || []).map((s: any) => s.id)
    if (subtopicIds.length === 0) return NextResponse.json({ recalibrated: 0, stillUnanswerable: 0 })

    // Past-exam questions that need re-grounding.
    const { data: allPastQ } = await supabase
      .from('questions')
      .select('id, question_text, answer_status, ai_confidence, subtopic_id')
      .eq('source', 'past_exam')
      .in('subtopic_id', subtopicIds)

    const toReground = (allPastQ || []).filter((q: any) =>
      q.answer_status === 'unanswerable' ||
      (q.ai_confidence !== null && q.ai_confidence < ANSWER_MIN_CONFIDENCE)
    )

    if (toReground.length === 0) return NextResponse.json({ recalibrated: 0, stillUnanswerable: 0 })

    // Fetch options for these questions.
    const qIds = toReground.map((q: any) => q.id)
    const { data: allOpts } = await supabase
      .from('question_options')
      .select('*')
      .in('question_id', qIds)
      .order('display_order')

    const optsByQ = new Map<string, any[]>()
    for (const opt of (allOpts || [])) {
      if (!optsByQ.has(opt.question_id)) optsByQ.set(opt.question_id, [])
      optsByQ.get(opt.question_id)!.push(opt)
    }

    // Embed all question texts in one parallelised batch.
    let qVectors: number[][] = []
    try {
      qVectors = await embedTexts(toReground.map((q: any) => q.question_text), 'query')
    } catch (e) {
      console.error('recalibrate: question embedding failed:', e)
      return NextResponse.json({ error: 'Embedding failed' }, { status: 500 })
    }

    // Mock-only: load all theory chunks + brute-force cosine (RPC unavailable).
    const usePgVector = !isEmbedMockEnabled()
    let theoryChunks: any[] = []
    let embeddedCandidates: Array<{ id: string; subtopicId: string | null; embedding: number[] | null }> = []
    if (!usePgVector) {
      const { data: theoryFiles } = await supabase
        .from('files').select('id').eq('exam_id', examId).eq('file_role', 'theory')
      const theoryFileIds = (theoryFiles || []).map((f: any) => f.id)
      if (theoryFileIds.length > 0) {
        const { data } = await supabase.from('chunks').select('*').in('file_id', theoryFileIds)
        theoryChunks = (data || []).filter((c: any) => c.subtopic_id)
      }
      const needEmbed = theoryChunks.filter(
        (c: any) => !Array.isArray(c.embedding) || c.embedding.length === 0
      )
      if (needEmbed.length > 0) {
        const vecs = await embedTexts(needEmbed.map((c: any) => c.content_text || ''))
        needEmbed.forEach((c: any, i: number) => { c.embedding = vecs[i] })
      }
      embeddedCandidates = theoryChunks.map((c: any) => ({
        id: c.id,
        subtopicId: c.subtopic_id,
        embedding: c.embedding,
      }))
    }

    let recalibrated = 0
    let stillUnanswerable = 0

    for (let qi = 0; qi < toReground.length; qi++) {
      const q = toReground[qi]
      const qVec = qVectors[qi]
      const opts = optsByQ.get(q.id) || []
      const optTexts = opts.map((o: any) => o.option_text)

      try {
        let matchChunkId = ''
        let matchSubtopicId: string | null = null
        let matchScore = 0
        let matchedContent = ''

        if (qVec && usePgVector) {
          const rpc = await matchChunkForQuestion(supabase, examId, qVec)
          matchChunkId = rpc.chunkId
          matchSubtopicId = rpc.subtopicId
          matchScore = rpc.score
          matchedContent = rpc.contentText
        } else if (qVec && embeddedCandidates.length > 0) {
          const bf = findBestChunkByEmbedding(qVec, embeddedCandidates)
          matchChunkId = bf.chunkId
          matchSubtopicId = bf.subtopicId
          matchScore = bf.score
          matchedContent = theoryChunks.find((c: any) => c.id === bf.chunkId)?.content_text || ''
        }

        const grounded = matchScore >= EMBED_MATCH_MIN_SCORE && !!matchSubtopicId
        const answer = await answerExamQuestion(
          q.question_text,
          optTexts,
          grounded ? matchedContent : '',
          exam.language || 'en'
        )
        const isAnswered = answer.answerable && answer.confidence >= ANSWER_MIN_CONFIDENCE

        await supabase
          .from('questions')
          .update({
            answer_status: isAnswered ? 'ai_answered' : 'unanswerable',
            ai_confidence: isAnswered ? answer.confidence : null,
            justification: answer.justification || '',
            matched_chunk_id: matchChunkId || null,
            subtopic_id: matchSubtopicId || q.subtopic_id,
          })
          .eq('id', q.id)

        if (isAnswered) {
          for (const opt of opts) {
            await supabase
              .from('question_options')
              .update({ is_correct: optionLetter(opt.option_text) === answer.choice })
              .eq('id', opt.id)
          }
          recalibrated++
        } else {
          stillUnanswerable++
        }
      } catch (e) {
        console.error(`recalibrate: failed for question ${q.id}:`, e)
        stillUnanswerable++
      }
    }

    return NextResponse.json({ recalibrated, stillUnanswerable })
  } catch (error) {
    console.error('recalibrate endpoint error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
