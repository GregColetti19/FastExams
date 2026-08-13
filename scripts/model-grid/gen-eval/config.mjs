/**
 * Generation-model evaluation: 5 generators, 100 questions each, one corpus.
 *
 * Embedding and answering are FIXED (qwen3-embedding-8b / qwen3.7-plus) — they
 * won the earlier grid, and holding them constant is what makes this a clean
 * read on the generation axis alone.
 */
import { join } from 'node:path'
import { ROOT } from '../config.mjs'

export const GE_DIR = join(ROOT, 'scripts/model-grid/gen-eval')
export const GE_DATA = join(GE_DIR, 'data')
export const GE_RESULTS = join(GE_DIR, 'results')

/**
 * Four corpora spanning subject and language.
 *
 * NAML is deliberately absent: 5 of its 7 PDFs are full-page scans with no text
 * layer (~1K extractable tokens total), so it cannot support question
 * generation. Fondamenti di Ricerca Operativa is Italian — the only non-English
 * corpus available, and the only way the language metric means anything.
 */
export const CORPORA = [
  {
    id: 'apde',
    name: 'Advanced Partial Differential Equations',
    subject: 'Advanced Partial Differential Equations',
    dir: 'TestData/APDE',
    // NS_Temam.pdf omitted: scanned images, 0 extractable characters.
    files: [
      'brezis_kato_example.pdf',
      'eigenvalues_Dirichlet_higher_dim.pdf',
      'embedding_detail.pdf',
      'exercise_Sobolev_spaces.pdf',
      'exercise_eigenvalues_Neumann.pdf',
      'exercise_multibump.pdf',
      'hopf.pdf',
      'integration_theory_notes.pdf',
      'kdv_update.pdf',
    ],
  },
  {
    id: 'napde',
    name: 'Numerical Analysis for PDEs',
    subject: 'Numerical Analysis',
    dir: 'TestData/NAPDE/NAPDE_notes',
    files: [
      'notes_NAPDE_01_BVP.pdf',
      'notes_NAPDE_02_SEM.pdf',
      'notes_NAPDE_03_DG-FEM.pdf',
      'notes_NAPDE_04_ADR.pdf',
      'notes_NAPDE_05_parabolic.pdf',
    ],
  },
  {
    id: 'philosophy',
    name: 'Philosophy of Science',
    subject: 'Philosophy of Science',
    dir: 'TestData/PHYLOSOPHY_of_SCIENCE',
    files: [
      'Lecture1_ScienceExperience_ppt.pdf',
      'Lecture2_LogicInduction_ppt.pdf',
      'Lecture3_InductivismFalsificationism_ppt.pdf',
      'Lecture4_LimitationsFalsificationism.pdf',
      'Lecture5_Kuhn_ppt.pdf',
      'Lecture6_Lakatos_ppt.pdf',
      'Lecture7_Feyerabend_ppt.pdf',
    ],
  },
  {
    id: 'fro',
    name: 'Fondamenti di Ricerca Operativa',
    subject: 'Operations Research',
    dir: 'TestData/Fondamenti_Ricerca_Operativa',
    files: [
      '01_Introduzione.pdf',
      '02_Modelli_parte_1.pdf',
      '04_ProgrammazioneLineare.pdf',
      '05-Simplesso.pdf',
      '06_Dualita.pdf',
      '07_Grafi.pdf',
      '09_FlussoMassimo.pdf',
      '10_PLI_B_B.pdf',
    ],
  },
]

export const N_QUESTIONS = 100
export const QUESTIONS_PER_CALL = 5

// Fixed axes (winners of the 45-cell grid).
export const EMBED_MODEL = {
  id: 'qwen/qwen3-embedding-8b',
  label: 'qwen3-8b',
  dimensions: 1536,
  asymmetric: true,
  pricePerM: 0.01,
}
export const ANSWER_MODEL = { id: 'qwen/qwen3.7-plus', label: 'qwen3.7-plus', pricePerM: [0.32, 1.28] }

// The variable under test.
export const GEN_MODELS = [
  { id: 'qwen/qwen3.7-flash', label: 'qwen3.7-flash', pricePerM: [0.03, 0.13] },
  { id: 'google/gemini-3.5-flash-lite', label: 'gemini-3.5-fl', pricePerM: [0.30, 2.50], mandatoryReasoning: true },
  { id: 'deepseek/deepseek-v4-flash', label: 'deepseek-v4-fl', pricePerM: [0.14, 0.28] },
  { id: 'z-ai/glm-4.7-flash', label: 'glm-4.7-flash', pricePerM: [0.06, 0.40] },
  { id: 'moonshotai/kimi-k2.6', label: 'kimi-k2.6', pricePerM: [0.58, 2.44] },
]

export const RETRIEVAL_K = 3
/**
 * Chunks handed to the generator per call. Matches RETRIEVAL_K so a question
 * written across passages is answerable from what retrieval actually returns —
 * asking for synthesis over more chunks than retrieval surfaces would produce
 * questions the pipeline cannot answer.
 */
export const SYNTHESIS_CHUNKS = 3
/** Subject label for prompt framing; mirrors production's inferred subject. */
export const SUBJECT_LABEL = 'Advanced Partial Differential Equations'
export const QWEN_QUERY_INSTRUCTION =
  'Instruct: Given an exam question, retrieve the course material passage that answers it\nQuery: '
