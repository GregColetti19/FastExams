export interface ClassificationResult {
  needsDocling: boolean
  avgCharsPerPage: number
  pageCount: number
}

export function classifyMarkdown(markdown: string, estimatedPageCount: number = 1): ClassificationResult {
  if (estimatedPageCount === 0) {
    estimatedPageCount = 1
  }

  const avgCharsPerPage = markdown.length / estimatedPageCount

  return {
    needsDocling: avgCharsPerPage < 100,
    avgCharsPerPage,
    pageCount: estimatedPageCount,
  }
}

export function estimatePageCountFromMarkdown(markdown: string): number {
  // Count page breaks or slide delimiters
  const pageBreaks = (markdown.match(/\n---\n/g) || []).length
  return Math.max(pageBreaks + 1, 1)
}
