import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { extractTopics, buildOutlineFromChunks } from '@/lib/ai/extract-topics'
import { generateQuestionsFromChunks } from '@/lib/ai/generate-questions'
import { extractPastExamQuestions } from '@/lib/ai/extract-past-exam-questions'
import { findBestMatchingChunk, generateJustification } from '@/lib/ai/match-to-theory'
import { generateFlashcardsFromChunks } from '@/lib/ai/generate-flashcards'

export async function POST(request: NextRequest) {
  try {
    const { fileId, fileRole } = await request.json()

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
      const { data: topicRecord } = await (supabase.from('topics') as any)
        .insert([{ exam_id: exam.id, name: topic.name }])
        .select() as any

      if (!topicRecord?.[0]) continue

      const topicId = topicRecord[0].id

      for (const subtopicName of topic.subtopics) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: subtopicRecord } = await (supabase.from('subtopics') as any)
          .insert([{ topic_id: topicId, name: subtopicName }])
          .select() as any

        if (subtopicRecord?.[0]) {
          topicMap.set(subtopicName, subtopicRecord[0].id)
        }
      }
    }

    // Step 3: Assign chunks to subtopics and generate questions
    let questionsCreated = 0

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
          const { data: qRecord } = await (supabase.from('questions') as any)
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

          if (!qRecord?.[0]) continue

          const questionId = qRecord[0].id

          // Insert options
          for (let i = 0; i < q.options.length; i++) {
            const opt = q.options[i]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('question_options') as any)
              .insert([
                {
                  question_id: questionId,
                  option_text: opt.text,
                  is_correct: opt.is_correct,
                  display_order: i,
                },
              ])
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
          await (supabase.from('questions') as any)
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
        }
      } catch (error) {
        console.error(`Error generating questions for subtopic ${subtopicName}:`, error)
      }
    }

    return NextResponse.json(
      {
        success: true,
        fileId,
        fileRole,
        topicsCreated: topicMap.size,
        questionsCreated,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Theory file processing error:', error)
    return NextResponse.json(
      {
        success: false,
        fileId,
        error: error instanceof Error ? error.message : 'Processing failed',
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
    // Reconstruct markdown from chunks
    const markdown = chunks.map((c) => c.content_text).join('\n\n')

    // Extract past exam questions
    const examResult = await extractPastExamQuestions(markdown, exam.language || 'en')

    // For each question, find best matching chunk and generate justification
    let questionsCreated = 0

    for (const q of examResult.questions) {
      if (q.type !== 'mcq' || !q.correct_answer) continue

      try {
        // Find best matching chunk
        const match = findBestMatchingChunk(q.question_text, [
          ...chunks.map((c) => ({
            id: c.id,
            text: c.content_text,
            subtopicId: c.subtopic_id,
          })),
        ])

        // If no subtopic assigned yet, we can't insert the question (past exam without theory)
        if (!match.subtopicId) {
          console.warn(`Question has no matching subtopic: ${q.question_text}`)
          continue
        }

        const matchedChunk = chunks.find((c) => c.id === match.chunkId)
        if (!matchedChunk) continue

        // Generate justification
        const justification = await generateJustification(
          q.question_text,
          q.correct_answer,
          (q.options || []).filter((opt) => !opt.includes(q.correct_answer!)),
          matchedChunk.content_text,
          exam.language || 'en'
        )

        // Insert question
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: qRecord } = await (supabase.from('questions') as any)
          .insert([
            {
              subtopic_id: match.subtopicId,
              chunk_id: match.chunkId,
              matched_chunk_id: match.chunkId,
              question_text: q.question_text,
              justification,
              language: exam.language || 'en',
              source: 'past_exam',
              past_exam_year: examResult.year,
            },
          ])
          .select() as any

        if (!qRecord?.[0]) continue

        const questionId = qRecord[0].id

        // Insert options
        const options = q.options || []
        for (let i = 0; i < options.length; i++) {
          const optText = options[i]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('question_options') as any)
            .insert([
              {
                question_id: questionId,
                option_text: optText,
                is_correct: optText === q.correct_answer,
                display_order: i,
              },
            ])
        }

        questionsCreated++
      } catch (error) {
        console.error(`Error processing past exam question:`, error)
      }
    }

    return NextResponse.json(
      {
        success: true,
        fileId,
        fileRole,
        questionsCreated,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Past exam file processing error:', error)
    return NextResponse.json(
      {
        success: false,
        fileId,
        error: error instanceof Error ? error.message : 'Processing failed',
        code: 'PROCESSING_FAILED',
      },
      { status: 500 }
    )
  }
}
