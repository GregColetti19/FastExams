import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'

/**
 * Delete an exam and all its dependent data. Real Supabase cascades via FK
 * ON DELETE CASCADE, but the mock DB has no cascade — so we delete children
 * explicitly, in dependency order. Doing it explicitly works in both.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const examId = params.examId
    const supabase = await createServerClient_()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const ids = (rows: any[] | null, col = 'id') => (rows || []).map((r) => r[col])

    // topics → subtopics → questions → options/attempts
    const { data: topics } = await sb.from('topics').select('id').eq('exam_id', examId)
    const topicIds = ids(topics)

    let subtopicIds: string[] = []
    if (topicIds.length) {
      const { data: subs } = await sb.from('subtopics').select('id').in('topic_id', topicIds)
      subtopicIds = ids(subs)
    }

    let questionIds: string[] = []
    if (subtopicIds.length) {
      const { data: qs } = await sb.from('questions').select('id').in('subtopic_id', subtopicIds)
      questionIds = ids(qs)
    }

    if (questionIds.length) {
      await sb.from('question_options').delete().in('question_id', questionIds)
      await sb.from('question_attempts').delete().in('question_id', questionIds)
    }
    if (subtopicIds.length) {
      await sb.from('questions').delete().in('subtopic_id', subtopicIds)
      await sb.from('study_sessions').delete().in('subtopic_id', subtopicIds)
      await sb.from('subtopics').delete().in('id', subtopicIds)
    }
    if (topicIds.length) {
      await sb.from('topics').delete().eq('exam_id', examId)
    }

    // files → chunks
    const { data: files } = await sb.from('files').select('id, storage_path').eq('exam_id', examId)
    const fileIds = ids(files)
    if (fileIds.length) {
      await sb.from('chunks').delete().in('file_id', fileIds)
      await sb.from('files').delete().eq('exam_id', examId)
    }

    await sb.from('exams').delete().eq('id', examId)

    return NextResponse.json({ success: true, examId }, { status: 200 })
  } catch (error) {
    console.error('Delete-exam error:', error)
    return NextResponse.json(
      { error: 'Failed to delete exam', code: 'DELETE_FAILED' },
      { status: 500 }
    )
  }
}
