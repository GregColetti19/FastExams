import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { extractTopics, buildOutlineFromChunks } from '@/lib/ai/extract-topics'
import { generateQuestionsFromChunks } from '@/lib/ai/generate-questions'
import { extractPastExamQuestions } from '@/lib/ai/extract-past-exam-questions'
import { findBestMatchingChunk } from '@/lib/ai/match-to-theory'
import { answerExamQuestion } from '@/lib/ai/answer-exam-question'
import { generateFlashcardsFromChunks } from '@/lib/ai/generate-flashcards'

// Below this match score, the theory grounding is too weak to trust an answer.
const MATCH_MIN_SCORE = 0.12
// Below this AI confidence, flag the question as unanswerable rather than assert.
const ANSWER_MIN_CONFIDENCE = 0.4

/** Leading option letter, e.g. "B. Mitral valve" -> "B". */
function optionLetter(optionText: string): string {
  const m = optionText.match(/^\s*([A-Za-z])/)
  return m ? m[1].toUpperCase() : ''
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
    // Step 1: Extract topics from chunk headings
    const outline = buildOutlineFromChunks(
      chunks
        .map((c) => c.candidate_subtopic)
        .filter((h) => h && h.length > 0)
    )

    const topicsResult = await extractTopics(outline, exam.language || 'en')

    // Step 2: Create topic and subtopic records
    const topicMap = new Map<string, string>() // subtopic name -> id

    for (const topic of topicsResult.topics) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: topicRecord, error: topicInsertError } = await (supabase.from('topics') as any)
        .insert([{ exam_id: exam.id, name: topic.name }])
        .select() as any

      if (topicInsertError) {
        throw new Error(`Failed to insert topic "${topic.name}": ${topicInsertError.message}`)
      }

      if (!topicRecord?.[0]) continue

      const topicId = topicRecord[0].id

      for (const subtopicName of topic.subtopics) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: subtopicRecord, error: subtopicInsertError } = await (supabase.from('subtopics') as any)
          .insert([{ topic_id: topicId, name: subtopicName }])
          .select() as any

        if (subtopicInsertError) {
          throw new Error(`Failed to insert subtopic "${subtopicName}": ${subtopicInsertError.message}`)
        }

        if (subtopicRecord?.[0]) {
          topicMap.set(subtopicName, subtopicRecord[0].id)
        }
      }
    }

    // Step 3: Assign chunks to subtopics and generate questions
    let questionsCreated = 0
    const subtopicErrors: string[] = []

    for (const subtopicName of Array.from(topicMap.keys())) {
      const subtopicId = topicMap.get(subtopicName)!
      const subtopicChunks = chunks.filter(
        (c) => c.candidate_subtopic === subtopicName || (c.candidate_topic?.includes(subtopicName))
      )

      if (subtopicChunks.length === 0) continue

      try {
        // Generate questions from chunks
        const questions = await generateQuestionsFromChunks(
          subtopicChunks.map((c) => ({
            text: c.content_text,
            hasImage: c.has_image,
            imagePath: c.image_storage_path,
          })),
          Array.from(topicMap.keys())[0], // topic name
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
          Array.from(topicMap.keys())[0],
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
        topicsCreated: topicMap.size,
        questionsCreated,
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
    const theoryCandidates = theoryChunks.map((c) => ({
      id: c.id,
      text: c.content_text,
      subtopicId: c.subtopic_id,
    }))

    let unsortedSubtopicId: string | null = null

    let questionsCreated = 0
    let questionsFlagged = 0
    const questionErrors: string[] = []

    for (const q of examResult.questions) {
      if (q.type !== 'mcq') continue // open questions can't be auto-graded yet

      try {
        // Find the best-matching theory chunk to ground the answer.
        const match =
          theoryCandidates.length > 0
            ? findBestMatchingChunk(q.question_text, theoryCandidates)
            : { chunkId: '', subtopicId: '', score: 0 }
        const grounded = match.score >= MATCH_MIN_SCORE && !!match.subtopicId
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
