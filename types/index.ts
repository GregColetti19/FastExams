// Shared TypeScript types for FastExams

export type FileRole = 'theory' | 'past_exam';
export type ProcessingStatus = 'pending' | 'processing' | 'generating_questions' | 'done' | 'error';
export type QuestionSource = 'ai_generated' | 'past_exam';
export type QuestionType = 'mcq' | 'true_false' | 'fill_blank' | 'flashcard';

// File processing
export interface ContentChunk {
  fileId: string;
  pageOrSlide: number;
  text: string;
  imageStoragePath: string | null;
  hasImage: boolean;
  candidateTopic?: string;
  candidateSubtopic?: string;
  language: string;
}

export interface PastExamQuestion {
  questionText: string;
  correctAnswer: string;
  otherOptions: string[];
  year?: string;
  pageNumber?: number;
}

// Supabase-aligned DB types
export interface Profile {
  id: string;
  email: string;
  created_at: string;
}

export interface Exam {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  language: string | null;
  created_at: string;
  updated_at: string;
}

export interface File {
  id: string;
  exam_id: string;
  file_name: string;
  file_type: string;
  file_role: FileRole;
  storage_path: string;
  size_bytes: number | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_at: string;
}

export interface Topic {
  id: string;
  exam_id: string;
  name: string;
  display_order: number;
  created_at: string;
}

export interface Subtopic {
  id: string;
  topic_id: string;
  name: string;
  display_order: number;
  mastery_score: number;
  created_at: string;
}

export interface Chunk {
  id: string;
  file_id: string;
  subtopic_id: string | null;
  content_text: string;
  image_storage_path: string | null;
  has_image: boolean;
  page_or_slide: number;
  created_at: string;
}

export interface Question {
  id: string;
  subtopic_id: string;
  chunk_id: string | null;
  question_text: string;
  image_storage_path: string | null;
  justification: string;
  language: string | null;
  question_type: QuestionType;
  source: QuestionSource;
  past_exam_year: string | null;
  matched_chunk_id: string | null;
  /** 0–1 confidence of an AI-inferred past-exam answer; null otherwise. */
  ai_confidence: number | null;
  /** 'ai_answered' | 'unanswerable' | 'user_set' */
  answer_status: string;
  times_seen: number;
  times_correct: number;
  current_interval_days: number;
  last_seen_at: string | null;
  next_review_at: string;
  created_at: string;
}

export interface QuestionOption {
  id: string;
  question_id: string;
  option_text: string;
  is_correct: boolean;
  display_order: number;
}

export interface StudySession {
  id: string;
  user_id: string;
  subtopic_id: string | null;
  session_type: 'quiz' | 'flashcard' | 'review';
  started_at: string;
  completed_at: string | null;
  total_questions: number;
  correct_count: number;
}

export interface QuestionAttempt {
  id: string;
  session_id: string;
  question_id: string;
  selected_option_id: string | null;
  is_correct: boolean;
  time_spent_seconds: number | null;
  attempted_at: string;
}

// Supabase Database type (placeholder)
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at'>; Update: Partial<Profile> };
      exams: { Row: Exam; Insert: Omit<Exam, 'id' | 'created_at' | 'updated_at'>; Update: Partial<Exam> };
      files: { Row: File; Insert: Omit<File, 'id' | 'created_at'>; Update: Partial<File> };
      topics: { Row: Topic; Insert: Omit<Topic, 'id' | 'created_at'>; Update: Partial<Topic> };
      subtopics: { Row: Subtopic; Insert: Omit<Subtopic, 'id' | 'created_at'>; Update: Partial<Subtopic> };
      chunks: { Row: Chunk; Insert: Omit<Chunk, 'id' | 'created_at'>; Update: Partial<Chunk> };
      questions: { Row: Question; Insert: Omit<Question, 'id' | 'created_at'>; Update: Partial<Question> };
      question_options: { Row: QuestionOption; Insert: Omit<QuestionOption, 'id'>; Update: Partial<QuestionOption> };
      study_sessions: { Row: StudySession; Insert: Omit<StudySession, 'id' | 'started_at'>; Update: Partial<StudySession> };
      question_attempts: { Row: QuestionAttempt; Insert: Omit<QuestionAttempt, 'id' | 'attempted_at'>; Update: Partial<QuestionAttempt> };
    };
  };
}
