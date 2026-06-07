// All AI prompts for FastExams - single source of truth
// Never write prompts inline in route handlers

export const PROMPTS = {
  topicExtraction: (params: { subject: string; language: string; outline: string }) => ({
    system: `You are an expert academic curriculum analyzer. You extract structured topic hierarchies from study material outlines.
Always respond with valid JSON only. No preamble, no markdown fences.`,
    user: `Below is the outline of a study document for a university ${params.subject} course.
The document language is: ${params.language}

Extract a 2-level hierarchy of Topic → Subtopic.
- Topics should be broad themes (e.g. "Cardiovascular System")
- Subtopics should be specific, teachable units (e.g. "Heart Valves", "Cardiac Cycle")
- Aim for 3–8 subtopics per topic
- Use the same language as the document

Outline:
${params.outline}

Respond with this exact JSON structure:
{
  "topics": [
    {
      "name": "Topic Name",
      "subtopics": ["Subtopic A", "Subtopic B", "Subtopic C"]
    }
  ]
}`,
  }),

  questionGenerationText: (params: {
    n: number
    language: string
    topic: string
    subtopic: string
    text: string
  }) => ({
    system: `You are an expert medical exam question writer. You create high-quality multiple choice questions
for university medical students. Always respond with valid JSON only. No preamble, no markdown fences.`,
    user: `Generate ${params.n} multiple choice questions from the following study content.
Document language: ${params.language}
Topic: ${params.topic}
Subtopic: ${params.subtopic}

Rules:
- Each question must have exactly 4 options
- Exactly one option must be correct
- Wrong options must be plausible (not obviously wrong)
- The justification must explain WHY the correct answer is right, and briefly why the others are wrong
- Questions must test understanding, not just memorization of exact phrases
- Write questions and options in the same language as the document (${params.language})
- Question types to use: mix of factual, applied, and clinical reasoning

Content:
${params.text}

Respond with this exact JSON structure:
{
  "questions": [
    {
      "question_text": "...",
      "options": [
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": true },
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": false }
      ],
      "justification": "..."
    }
  ]
}`,
  }),

  questionGenerationImage: (params: {
    language: string
    topic: string
    subtopic: string
    text: string
  }) => ({
    system: `You are an expert medical exam question writer specializing in visual/diagram-based questions.
Always respond with valid JSON only. No preamble, no markdown fences.`,
    user: `An image is from a medical study document.
Document language: ${params.language}
Topic: ${params.topic}
Subtopic: ${params.subtopic}

Additional text context from this slide/page:
${params.text}

Generate 2 multiple choice questions that specifically reference the image/diagram.
At least one question must require visual interpretation of the image.

Rules:
- Each question must have exactly 4 options
- Exactly one option is correct
- Wrong options must be plausible
- Reference the image explicitly in the question (e.g. "In the diagram shown...", "Based on the figure...")
- Justification must explain what to look for in the image
- Write in ${params.language}

Respond with this exact JSON structure:
{
  "questions": [
    {
      "question_text": "...",
      "options": [
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": true },
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": false }
      ],
      "justification": "..."
    }
  ]
}`,
  }),

  flashcardGeneration: (params: { n: number; language: string; topic: string; subtopic: string; text: string }) => ({
    system: `You are an expert at creating concise, effective study flashcards using active recall principles.
Always respond with valid JSON only. No preamble, no markdown fences.`,
    user: `Create ${params.n} flashcards from the following study content.
Document language: ${params.language}
Topic: ${params.topic}
Subtopic: ${params.subtopic}

Rules:
- Front: a clear question or concept prompt
- Back: a concise answer (2–4 sentences max)
- Focus on definitions, mechanisms, classifications, and clinical relevance
- Write in ${params.language}

Content:
${params.text}

Respond with:
{
  "flashcards": [
    { "front": "...", "back": "..." }
  ]
}`,
  }),

  pastExamExtraction: (params: { language: string; markdown: string }) => ({
    system: `You are an expert at extracting structured question-and-answer data from university exam papers.
Always respond with valid JSON only. No preamble, no markdown fences.`,
    user: `The following is a past exam paper converted to markdown.
Extract all questions and their answer options.
Document language: ${params.language}

Rules:
- Extract every question verbatim (preserve exact wording)
- Identify the correct answer if an answer key is present; otherwise mark correct_answer as null
- Extract all answer options for MCQ questions
- For non-MCQ questions (open text), still extract the question and mark type as 'open'
- If the exam year is visible in the document, extract it
- Preserve question numbering

Content:
${params.markdown}

Respond with:
{
  "year": "2023",
  "questions": [
    {
      "question_number": "1",
      "question_text": "...",
      "type": "mcq",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_answer": "B",
      "correct_answer_text": "..."
    }
  ]
}`,
  }),

  justificationGeneration: (params: {
    language: string
    question_text: string
    correct_answer: string
    wrong_options: string[]
    matched_chunk_text: string
  }) => ({
    system: `You are an expert medical educator. You write clear, concise explanations for why exam answers are correct.
Always respond with valid JSON only. No preamble, no markdown fences.`,
    user: `A past exam question has been matched to the following theory content.
Document language: ${params.language}

Question: ${params.question_text}
Correct answer: ${params.correct_answer}
Wrong options: ${params.wrong_options.join(', ')}

Relevant theory content:
${params.matched_chunk_text}

Write a justification explaining:
1. Why the correct answer is right (grounded in the theory content above)
2. Why each wrong option is incorrect (brief, 1 sentence each)

Respond with:
{
  "justification": "..."
}`,
  }),
}

/**
 * Parse JSON response from Claude, stripping markdown fences if present
 */
export function parseJsonResponse(text: string): unknown {
  const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
  return JSON.parse(cleaned)
}
