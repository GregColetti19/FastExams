import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { extractTopicHierarchy, tiebreakSubtopic } from '@/lib/ai/extract-topics'
import { assignChunksToSubtopics } from '@/lib/ai/assign-subtopics'
import { generateQuestionsFromChunks } from '@/lib/ai/generate-questions'
import { extractPastExamQuestions } from '@/lib/ai/extract-past-exam-questions'
import { findBestChunkByEmbedding } from '@/lib/ai/match-to-theory'
import { embedTexts } from '@/lib/ai/embeddings'
import { answerExamQuestion } from '@/lib/ai/answer-exam-question'
import { generateFlashcardsFromChunks } from '@/lib/ai/generate-flashcards'

// Below this cosine score, theory grounding is too weak to attempt an answer.
// Permissive on purpose: the answer step (confidence/answerable) is the real
// quality gate; this only decides whether to try grounding at all.
const EMBED_MATCH_MIN_SCORE = 0.25
// Below this AI confidence, flag the question as unanswerable rather than assert.
const ANSWER_MIN_CONFIDENCE = 0.4

/** Leading option letter, e.g. "B. Mitral valve" -> "B". */
function optionLetter(optionText: string): string {
  const m = optionText.match(/^\s*([A-Za-z])/)
  return m ? m[1].toUpperCase() : ''
}

/** Evenly spaced sample across an array so the tree sees the whole document. */
function stratifiedSample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items
  const step = items.length / n
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)])
  return out
}

/**
 * Ensure a fallback subtopic exists to hold past-exam questions that don't
 * match any theory (questions.subtopic_id is NOT NULL). Returns its id.
 */
async function ensureUnsortedSubtopic(supabase: any, examId: string): Promise<string | null> {
  const { data: topicRows } = await (supabase.from('topics') as any)
    .insert([{ exam_id: examId, name: 'Past Exam (unsorted)' }])
    .select()
  const topicId = topicRows?.[0]?.id
  if (!topicId) return null
  const { data: subRows } = await (supabase.from('subtopics') as any)
    .insert([{ topic_id: topicId, name: 'Unsorted' }])
    .select()
  return subRows?.[0]?.id ?? null
}

export async function POST(request: NextRequest) {
  // Hoisted so the outer catch can reference fileId when writing the error back.
  let fileId: string | undefined
  try {
    const body = await request.json()
    fileId = body.fileId
    const fileRole = body.fileRole

    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId required', code: 'MISSING_FILE_ID' },
        { status: 400 }
      )
    }

    const supabase = await createServerClient_()

    // Fetch file record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: file } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single() as any

    if (!file) {
      return NextResponse.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, { status: 404 })
    }

    // Fetch exam for language
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: exam } = await supabase
      .from('exams')
      .select('*')
      .eq('id', file.exam_id)
      .single() as any

    if (!exam) {
      return NextResponse.json({ error: 'Exam not found', code: 'EXAM_NOT_FOUND' }, { status: 404 })
    }

    // Fetch chunks for this file
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chunks } = await supabase
      .from('chunks')
      .select('*')
      .eq('file_id', fileId) as any

    if (!chunks || chunks.length === 0) {
      return NextResponse.json(
        { error: 'No chunks found for file', code: 'NO_CHUNKS' },
        { status: 400 }
      )
    }

    if (fileRole === 'theory') {
      return await processTheoryFile(supabase, file, exam, chunks, fileId, fileRole)
    } else if (fileRole === 'past_exam') {
      return await processPastExamFile(supabase, file, exam, chunks, fileId, fileRole)
    } else {
      return NextResponse.json({ error: 'Invalid fileRole', code: 'INVALID_FILE_ROLE' }, { status: 400 })
    }
  } catch (error) {
    console.error('Generate-questions endpoint error:', error)
    // Write error back to files table on outer failure
    try {
      const supabase = await createServerClient_()
      const errorMsg = error instanceof Error ? error.message : 'Processing failed'
      await (supabase.from('files') as any)
        .update({
          processing_status: 'error',
          processing_error: `Question generation failed: ${errorMsg}`,
        })
        .eq('id', fileId)
    } catch (dbError) {
      console.error('Failed to update file status on error:', dbError)
    }
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

async function processTheoryFile(
  supabase: any,
  file: any,
  exam: any,
  chunks: any[],
  fileId: string,
  fileRole: string
) {
  try {
    // Step 1: Build a content-grounded topic→subtopic tree. Real converter
    // output drops headings, so infer the tree from a sample of actual content.
    const hierarchy = await extractTopicHierarchy(
      stratifiedSample(chunks.map((c) => c.content_text || ''), 12),
      exam.language || 'en'
    )

    // Step 2: Create topic + subtopic records; collect seeds (name+description+id).
    const seeds: Array<{ topic: string; name: string; description: string; id: string }> = []
    for (const topic of hierarchy.topics) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: topicRecord, error: topicInsertError } = await (supabase.from('topics') as any)
        .insert([{ exam_id: exam.id, name: topic.name }])
        .select()
      if (topicInsertError) {
        throw new Error(`Failed to insert topic "${topic.name}": ${topicInsertError.message}`)
      }
      const topicId = topicRecord?.[0]?.id
      if (!topicId) continue
      for (const sub of topic.subtopics || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: subRecord, error: subErr } = await (supabase.from('subtopics') as any)
          .insert([{ topic_id: topicId, name: sub.name }])
          .select()
        if (subErr) throw new Error(`Failed to insert subtopic "${sub.name}": ${subErr.message}`)
        if (subRecord?.[0]) {
          seeds.push({
            topic: topic.name,
            name: sub.name,
            description: sub.description || sub.name,
            id: subRecord[0].id,
          })
        }
      }
    }

    // Step 3: Assign chunks to subtopics via seeded embedding refinement.
    // Ensure chunk embeddings (stored at ingest, else compute now).
    const needEmb = chunks.filter((c) => !Array.isArray(c.embedding) || c.embedding.length === 0)
    if (needEmb.length > 0) {
      try {
        const vecs = await embedTexts(needEmb.map((c) => c.content_text || ''))
        needEmb.forEach((c, i) => { c.embedding = vecs[i] })
      } catch (e) {
        console.error('Theory chunk embedding failed:', e)
      }
    }
    const descVecs = seeds.length > 0 ? await embedTexts(seeds.map((s) => s.description)) : []
    const subtopicSeeds = seeds.map((s, i) => ({ topic: s.topic, name: s.name, embedding: descVecs[i] }))
    const chunkVecs = chunks
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
      .map((c) => ({ id: c.id, embedding: c.embedding as number[] }))

    const assignments = assignChunksToSubtopics(chunkVecs, subtopicSeeds)

    // Step 3b: LLM tie-break for the unconfident minority only (cost control).
    const subtopicNames = seeds.map((s) => s.name)
    for (const a of assignments) {
      if (a.confident) continue
      const chunk = chunks.find((c) => c.id === a.chunkId)
      if (!chunk) continue
      try {
        const pick = await tiebreakSubtopic(chunk.content_text || '', subtopicNames, exam.language || 'en')
        if (pick) {
          a.subtopic = pick
          a.topic = seeds.find((s) => s.name === pick)?.topic ?? a.topic
          a.confident = true
        }
      } catch (e) {
        console.error('Tiebreak failed for chunk', a.chunkId, e)
      }
    }

    // Step 3c: persist chunk → subtopic and group chunks per subtopic.
    const nameToId = new Map(seeds.map((s) => [s.name, s.id]))
    const assignedMap = new Map<string, any[]>()
    for (const a of assignments) {
      if (!a.subtopic) continue
      const subtopicId = nameToId.get(a.subtopic)
      const chunk = chunks.find((c) => c.id === a.chunkId)
      if (!subtopicId || !chunk) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('chunks') as any).update({ subtopic_id: subtopicId }).eq('id', a.chunkId)
      if (!assignedMap.has(subtopicId)) assignedMap.set(subtopicId, [])
      assignedMap.get(subtopicId)!.push(chunk)
    }

    // Skip AI question generation when the exam already has real past-exam
    // questions — those are authoritative and we keep them instead. Theory is
    // still parsed into the topic/subtopic tree above, which is needed to
    // ground past-exam answers and to structure study. Users can generate AI
    // questions on demand later via the "Create Questions" button (backlog).
    const { data: pastExamFiles } = await (supabase.from('files') as any)
      .select('id')
      .eq('exam_id', exam.id)
      .eq('file_role', 'past_exam')
    const hasPastExams = (pastExamFiles || []).length > 0

    // Step 4: Generate questions + flashcards per subtopic from its chunks.
    let questionsCreated = 0
    const subtopicErrors: string[] = []

    for (const seed of seeds) {
      if (hasPastExams) break // real questions exist — don't AI-generate
      const subtopicId = seed.id
      const subtopicName = seed.name
      const subtopicChunks = assignedMap.get(subtopicId) || []
      if (subtopicChunks.length === 0) continue

      try {
        // Generate questions from chunks
        const questions = await generateQuestionsFromChunks(
          subtopicChunks.map((c) => ({
            text: c.content_text,
            hasImage: c.has_image,
            imagePath: c.image_storage_path,
          })),
          seed.topic,
          subtopicName,
          exam.language || 'en'
        )

        // Insert questions
        for (const q of questions) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: qRecord, error: qInsertError } = await (supabase.from('questions') as any)
            .insert([
              {
                subtopic_id: subtopicId,
                chunk_id: subtopicChunks[0].id,
                question_text: q.question_text,
                justification: q.justification,
                language: exam.language || 'en',
                source: 'ai_generated',
              },
            ])
            .select() as any

          if (qInsertError) {
            throw new Error(`Failed to insert question: ${qInsertError.message}`)
          }

          if (!qRecord?.[0]) continue

          const questionId = qRecord[0].id

          // Insert options
          for (let i = 0; i < q.options.length; i++) {
            const opt = q.options[i]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error: optInsertError } = await (supabase.from('question_options') as any)
              .insert([
                {
                  question_id: questionId,
                  option_text: opt.text,
                  is_correct: opt.is_correct,
                  display_order: i,
                },
              ])
            if (optInsertError) {
              console.error(`Failed to insert option for question ${questionId}:`, optInsertError.message)
            }
          }

          questionsCreated++
        }

        // Generate flashcards
        const flashcards = await generateFlashcardsFromChunks(
          subtopicChunks.map((c) => ({ text: c.content_text })),
          seed.topic,
          subtopicName,
          exam.language || 'en'
        )

        // Insert flashcards as special questions
        for (const fc of flashcards) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: fcInsertError } = await (supabase.from('questions') as any)
            .insert([
              {
                subtopic_id: subtopicId,
                chunk_id: subtopicChunks[0].id,
                question_text: fc.front,
                justification: fc.back,
                language: exam.language || 'en',
                question_type: 'flashcard',
                source: 'ai_generated',
              },
            ])
          if (fcInsertError) {
            console.error(`Failed to insert flashcard for subtopic ${subtopicName}:`, fcInsertError.message)
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`Error generating questions for subtopic ${subtopicName}:`, msg)
        subtopicErrors.push(`${subtopicName}: ${msg}`)
      }
    }

    // Write success + mark done
    await (supabase.from('files') as any)
      .update({ processing_status: 'done' })
      .eq('id', fileId)

    // If there were partial failures, log them in processing_error
    if (subtopicErrors.length > 0) {
      const errorSummary = subtopicErrors.slice(0, 3).join('; ')
      await (supabase.from('files') as any)
        .update({ processing_error: `Partial failure in ${subtopicErrors.length} subtopic(s): ${errorSummary}` })
        .eq('id', fileId)
    }

    return NextResponse.json(
      {
        success: true,
        fileId,
        fileRole,
        subtopicsCreated: seeds.length,
        questionsCreated,
        generationSkipped: hasPastExams,
        subtopicErrors: subtopicErrors.length > 0 ? subtopicErrors : undefined,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Theory file processing error:', error)
    const errorMsg = error instanceof Error ? error.message : 'Processing failed'
    await (supabase.from('files') as any)
      .update({
        processing_status: 'error',
        processing_error: `Question generation failed: ${errorMsg}`,
      })
      .eq('id', fileId)
    return NextResponse.json(
      {
        success: false,
        fileId,
        error: errorMsg,
        code: 'PROCESSING_FAILED',
      },
      { status: 500 }
    )
  }
}

async function processPastExamFile(
  supabase: any,
  file: any,
  exam: any,
  chunks: any[],
  fileId: string,
  fileRole: string
) {
  try {
    // Reconstruct markdown from this past-exam file's chunks
    const markdown = chunks.map((c) => c.content_text).join('\n\n')

    // Extract the questions (options preserved; answer key usually absent)
    const examResult = await extractPastExamQuestions(markdown, exam.language || 'en')

    // Grounding source = THEORY chunks for this exam (assigned to subtopics by
    // the theory pipeline). Past exams carry no answer key, so we infer the
    // answer from theory and cite it — never from the exam's own text.
    const { data: theoryFiles } = await (supabase.from('files') as any)
      .select('id')
      .eq('exam_id', exam.id)
      .eq('file_role', 'theory')
    const theoryFileIds = (theoryFiles || []).map((f: any) => f.id)

    let theoryChunks: any[] = []
    if (theoryFileIds.length > 0) {
      const { data } = await (supabase.from('chunks') as any)
        .select('*')
        .in('file_id', theoryFileIds)
      theoryChunks = (data || []).filter((c: any) => c.subtopic_id)
    }
    // Embed theory chunks (use stored embedding, else compute on demand) so we
    // rank by semantic similarity instead of keyword overlap.
    const needEmbed = theoryChunks.filter(
      (c) => !Array.isArray(c.embedding) || c.embedding.length === 0
    )
    if (needEmbed.length > 0) {
      try {
        const vecs = await embedTexts(needEmbed.map((c) => c.content_text || ''))
        needEmbed.forEach((c, i) => {
          c.embedding = vecs[i]
        })
      } catch (e) {
        console.error('Theory chunk embedding failed:', e)
      }
    }
    const embeddedCandidates = theoryChunks.map((c) => ({
      id: c.id,
      subtopicId: c.subtopic_id,
      embedding: c.embedding,
    }))

    // Embed all MCQ question texts in one batch.
    const mcqs = examResult.questions.filter((q) => q.type === 'mcq')
    let qVectors: number[][] = []
    if (mcqs.length > 0 && embeddedCandidates.length > 0) {
      try {
        qVectors = await embedTexts(mcqs.map((q) => q.question_text))
      } catch (e) {
        console.error('Question embedding failed:', e)
      }
    }

    let unsortedSubtopicId: string | null = null

    let questionsCreated = 0
    let questionsFlagged = 0
    const questionErrors: string[] = []

    for (let qi = 0; qi < mcqs.length; qi++) {
      const q = mcqs[qi]

      try {
        // Rank theory chunks by cosine similarity to the question.
        const qVec = qVectors[qi]
        const match =
          qVec && embeddedCandidates.length > 0
            ? findBestChunkByEmbedding(qVec, embeddedCandidates)
            : { chunkId: '', subtopicId: null as string | null, score: 0 }
        const grounded = match.score >= EMBED_MATCH_MIN_SCORE && !!match.subtopicId
        const matchedChunk = grounded
          ? theoryChunks.find((c) => c.id === match.chunkId)
          : undefined

        // AI-answer from the matched theory (empty source => unanswerable).
        const answer = await answerExamQuestion(
          q.question_text,
          q.options || [],
          matchedChunk?.content_text || '',
          exam.language || 'en'
        )

        const isAnswered =
          answer.answerable && answer.confidence >= ANSWER_MIN_CONFIDENCE

        // Where to file it: matched subtopic, else a shared "Unsorted" bucket.
        let subtopicId = grounded ? match.subtopicId : null
        if (!subtopicId) {
          if (!unsortedSubtopicId) {
            unsortedSubtopicId = await ensureUnsortedSubtopic(supabase, exam.id)
          }
          subtopicId = unsortedSubtopicId
        }
        if (!subtopicId) {
          questionErrors.push(`No subtopic available for: ${q.question_text.slice(0, 60)}`)
          continue
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: qRecord, error: qInsertError } = await (supabase.from('questions') as any)
          .insert([
            {
              subtopic_id: subtopicId,
              chunk_id: matchedChunk?.id ?? null,
              matched_chunk_id: matchedChunk?.id ?? null,
              question_text: q.question_text,
              justification: answer.justification || '',
              language: exam.language || 'en',
              source: 'past_exam',
              past_exam_year: examResult.year,
              ai_confidence: isAnswered ? answer.confidence : null,
              answer_status: isAnswered ? 'ai_answered' : 'unanswerable',
            },
          ])
          .select() as any

        if (qInsertError) {
          throw new Error(`Failed to insert question: ${qInsertError.message}`)
        }
        if (!qRecord?.[0]) continue
        const questionId = qRecord[0].id

        // Insert options. Mark the AI-chosen letter correct only when answered.
        const options = q.options || []
        for (let i = 0; i < options.length; i++) {
          const optText = options[i]
          const isCorrect = isAnswered && optionLetter(optText) === answer.choice
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: optInsertError } = await (supabase.from('question_options') as any)
            .insert([
              {
                question_id: questionId,
                option_text: optText,
                is_correct: isCorrect,
                display_order: i,
              },
            ])
          if (optInsertError) {
            console.error(`Failed to insert option for question ${questionId}:`, optInsertError.message)
          }
        }

        if (isAnswered) questionsCreated++
        else questionsFlagged++
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`Error processing past exam question:`, msg)
        questionErrors.push(msg)
      }
    }

    // Write success + mark done
    await (supabase.from('files') as any)
      .update({ processing_status: 'done' })
      .eq('id', fileId)

    // If there were failures, log them
    if (questionErrors.length > 0) {
      const errorSummary = questionErrors.slice(0, 3).join('; ')
      await (supabase.from('files') as any)
        .update({ processing_error: `Failed to process ${questionErrors.length} question(s): ${errorSummary}` })
        .eq('id', fileId)
    }

    return NextResponse.json(
      {
        success: true,
        fileId,
        fileRole,
        questionsCreated,
        questionsFlagged,
        questionErrors: questionErrors.length > 0 ? questionErrors : undefined,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Past exam file processing error:', error)
    const errorMsg = error instanceof Error ? error.message : 'Processing failed'
    await (supabase.from('files') as any)
      .update({
        processing_status: 'error',
        processing_error: `Question generation failed: ${errorMsg}`,
      })
      .eq('id', fileId)
    return NextResponse.json(
      {
        success: false,
        fileId,
        error: errorMsg,
        code: 'PROCESSING_FAILED',
      },
      { status: 500 }
    )
  }
}
