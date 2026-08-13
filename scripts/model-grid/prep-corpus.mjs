#!/usr/bin/env node
/**
 * Stage 1 of the model grid: PDFs -> markdown -> chunks. Free (no API calls).
 *
 * Converts the eval corpus with the same markitdown the app's converter service
 * uses, chunks it the same way buildChunks/splitChunksByTokens do, and writes
 * one JSON per subject. Every later stage reads these files, so all 45 grid
 * cells see byte-identical text — chunking is held constant and only the three
 * model axes vary.
 *
 * Usage: node scripts/model-grid/prep-corpus.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = join(ROOT, 'scripts/model-grid/data')
const PY = join(ROOT, 'converter/venv/bin/python')

// Subject corpora. Deliberately two very different shapes: dense STEM lecture
// notes (heavy formulas) vs humanities slide decks (prose, sparse pages).
const SUBJECTS = [
  {
    id: 'napde',
    name: 'Numerical Analysis for PDEs',
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
]

/** Convert one PDF via the converter venv's markitdown (same lib as the service). */
function pdfToMarkdown(absPath) {
  const script = `
import sys, warnings
warnings.filterwarnings('ignore')
from markitdown import MarkItDown
sys.stdout.write(MarkItDown().convert(sys.argv[1]).text_content)
`
  return execFileSync(PY, ['-c', script, absPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

// --- chunking (ports lib/processing/chunk-builder.ts; that module is TS and
// this script is plain node, so the logic is mirrored rather than imported.
// Keep in sync if the real chunker changes.) ---

const estimateTokens = (t) => Math.ceil(t.length / 4)

function buildChunks(markdown, fileId) {
  const chunks = []
  const sections = markdown.split(/^## /m).filter((s) => s.trim())
  const introMatch = markdown.match(/^(.*?)\n## /s)
  let i = 0
  if (introMatch && introMatch[1].trim()) {
    chunks.push({ fileId, pageOrSlide: i++, text: introMatch[1].trim(), heading: '' })
  }
  for (const section of sections) {
    const lines = section.split('\n')
    const heading = lines[0] || 'Untitled'
    const content = lines.slice(1).join('\n').trim()
    if (content.length > 0) chunks.push({ fileId, pageOrSlide: i++, text: content, heading: heading.trim() })
  }
  if (chunks.length === 0 && markdown.trim().length > 0) {
    chunks.push({ fileId, pageOrSlide: 0, text: markdown.trim(), heading: '' })
  }
  return chunks
}

function splitChunksByTokens(chunks, target = 500) {
  const out = []
  for (const chunk of chunks) {
    if (estimateTokens(chunk.text) <= target) {
      out.push(chunk)
      continue
    }
    const paras = chunk.text.split('\n\n')
    let cur = ''
    let curTok = 0
    for (const p of paras) {
      const pt = estimateTokens(p)
      if (curTok + pt > target && cur.length > 0) {
        out.push({ ...chunk, text: cur.trim() })
        cur = p
        curTok = pt
      } else {
        cur += (cur ? '\n\n' : '') + p
        curTok += pt
      }
    }
    if (cur.trim().length > 0) out.push({ ...chunk, text: cur.trim() })
  }
  return out
}

// Drop chunks too small to ground a question — slide decks produce a lot of
// title-only fragments that would otherwise pollute retrieval and question gen.
const MIN_CHUNK_CHARS = 200

function main() {
  if (!existsSync(PY)) {
    console.error(`Converter venv not found at ${PY}\nRun: cd converter && python3.11 -m venv venv && pip install -r requirements.txt`)
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })

  for (const subject of SUBJECTS) {
    console.log(`\n=== ${subject.name} ===`)
    let all = []
    for (const f of subject.files) {
      const abs = join(ROOT, subject.dir, f)
      if (!existsSync(abs)) {
        console.error(`  MISSING ${f}`)
        process.exit(1)
      }
      const md = pdfToMarkdown(abs)
      const raw = splitChunksByTokens(buildChunks(md, basename(f, '.pdf')))
      const kept = raw.filter((c) => c.text.length >= MIN_CHUNK_CHARS)
      console.log(`  ${f.slice(0, 44).padEnd(46)} ${String(md.length).padStart(8)} chars -> ${String(kept.length).padStart(4)} chunks (${raw.length - kept.length} dropped)`)
      all = all.concat(kept.map((c, i) => ({ ...c, id: `${subject.id}:${basename(f, '.pdf')}:${i}` })))
    }
    const tokens = all.reduce((n, c) => n + estimateTokens(c.text), 0)
    const out = join(OUT_DIR, `corpus-${subject.id}.json`)
    writeFileSync(out, JSON.stringify({ subject: subject.id, name: subject.name, chunks: all }, null, 2))
    console.log(`  -> ${all.length} chunks, ~${tokens.toLocaleString()} tokens`)
    console.log(`  -> ${out}`)
  }
}

main()
