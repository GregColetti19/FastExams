'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { IconUpload, IconCheck, IconX, IconAlertTriangle } from '@tabler/icons-react'
import { createClient } from '@/lib/supabase/client'
import { FileRole, ProcessingStatus } from '@/types'
import { Button } from '@/components/cadence/Button'
import { StepTrack, StageLabel, type UploadStage } from '@/components/cadence/StepTrack'
import { cn } from '@/lib/utils'

// If any file stays in generating_questions longer than this, surface a retry.
const STALL_TIMEOUT_MS = 10 * 60 * 1000

// Conversion (pending/processing) is triggered by a detached call from
// /api/upload, so a dropped request or a deploy mid-processing leaves the file
// at 'pending' forever with nothing to retry it. Longer than STALL_TIMEOUT_MS
// because a large scanned PDF escalating to Docling is legitimately slow.
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000

interface UploadZoneProps {
  examId: string
}

// ProcessingStatus (DB) -> UploadStage (StepTrack). 'pending' reads as the
// track's first segment (about to process); 'error' isn't a stage, it's a
// terminal state rendered separately.
function toStage(status: ProcessingStatus): UploadStage {
  if (status === 'pending' || status === 'processing') return 'processing'
  if (status === 'ready') return 'ready'
  if (status === 'generating_questions') return 'generating'
  return 'done'
}

export function UploadZone({ examId }: UploadZoneProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [fileRole, setFileRole] = useState<FileRole>('theory')
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [stalled, setStalled] = useState(false)
  // Set when conversion stalls at pending/processing. Distinct from `stalled`
  // (generation): there is no generate-retry to offer, only re-upload.
  const [processingStalled, setProcessingStalled] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [files, setFiles] = useState<Array<{ id: string; name: string; status: ProcessingStatus; error?: string }>>([])
  const [pollInterval, setPollInterval] = useState<number | null>(null)
  const [isExistingExam, setIsExistingExam] = useState(false)
  const generatingStartedAt = useRef<number | null>(null)
  const processingStartedAt = useRef<number | null>(null)
  const supabase = createClient()

  // Detect if this exam already has generated content (topics exist).
  // If so, new uploads trigger recalibration rather than first-time generation.
  useEffect(() => {
    supabase
      .from('topics')
      .select('id')
      .eq('exam_id', examId)
      .limit(1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: any) => setIsExistingExam((data || []).length > 0))
  }, [examId, supabase])

  // Poll for file status updates
  useEffect(() => {
    if (!pollInterval) return

    const interval = setInterval(async () => {
      const updatedFiles = await Promise.all(
        files.map(async (f) => {
          if (f.status === 'done' || f.status === 'error') return f

          const { data } = await supabase.from('files').select('processing_status, processing_error').eq('id', f.id).single() as any

          return {
            ...f,
            status: data?.processing_status || f.status,
            error: data?.processing_error || f.error,
          }
        })
      )

      setFiles(updatedFiles)

      // 'ready' (converted, awaiting generation) is a settle point — stop
      // polling and let the user trigger generation. After generation, files
      // reach 'done'/'error'; then redirect to the populated exam dashboard.
      const settled = updatedFiles.every(
        (f) => f.status === 'ready' || f.status === 'done' || f.status === 'error'
      )
      if (settled) {
        setPollInterval(null)
        generatingStartedAt.current = null
        const generated = updatedFiles.every((f) => f.status === 'done' || f.status === 'error')
        if (generated && updatedFiles.some((f) => f.status === 'done')) {
          router.push(`/exam/${examId}`)
        }
      }

      // Stall detection: any file stuck at generating_questions beyond the timeout.
      const anyGenerating = updatedFiles.some((f) => f.status === 'generating_questions')
      if (anyGenerating && generatingStartedAt.current !== null) {
        if (Date.now() - generatingStartedAt.current > STALL_TIMEOUT_MS) {
          setPollInterval(null)
          setGenerating(false)
          setStalled(true)
        }
      }

      // Same for conversion. Without this a file whose detached process-file
      // call never landed polls forever and the tester just sees a spinner.
      const anyProcessing = updatedFiles.some(
        (f) => f.status === 'pending' || f.status === 'processing'
      )
      if (anyProcessing && processingStartedAt.current !== null) {
        if (Date.now() - processingStartedAt.current > PROCESSING_TIMEOUT_MS) {
          setPollInterval(null)
          setProcessingStalled(true)
        }
      } else if (!anyProcessing) {
        processingStartedAt.current = null
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [pollInterval, files, supabase, router, examId])

  const handleGenerate = async (retry = false) => {
    setGenerating(true)
    setStalled(false)
    setUploadError(null)
    try {
      const res = await fetch('/api/generate-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId, retry, recalibrate: isExistingExam }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Generation failed (${res.status})`)
      }
      // Optimistically flip ready/stalled files to generating, then resume polling.
      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'ready' || f.status === 'generating_questions'
            ? { ...f, status: 'generating_questions' as ProcessingStatus }
            : f
        )
      )
      generatingStartedAt.current = Date.now()
      setPollInterval(2000)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Generation failed')
      setGenerating(false)
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files)
    }
  }

  const handleFiles = async (fileList: FileList) => {
    const file = fileList[0]

    if (!file) return

    setUploadError(null)

    // Validate file type
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.pdf') && !fileName.endsWith('.pptx')) {
      setUploadError('Only PDF and PPTX files are supported')
      return
    }

    setUploading(true)
    setUploadProgress(0)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('examId', examId)
      formData.append('fileRole', fileRole)

      // Upload with progress tracking
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100))
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status === 201) {
          const response = JSON.parse(xhr.responseText)
          setFiles([
            ...files,
            {
              id: response.fileId,
              name: file.name,
              status: 'pending' as ProcessingStatus,
            },
          ])
          processingStartedAt.current = Date.now()
          setProcessingStalled(false)
          setPollInterval(2000) // Start polling
        } else {
          try {
            const body = JSON.parse(xhr.responseText)
            // Quota and auth are expected outcomes, not faults — show the
            // server's message plainly instead of dressing it as a failure.
            if (body.code === 'QUOTA_EXCEEDED' || body.code === 'UNAUTHORIZED') {
              setUploadError(body.error)
            } else {
              setUploadError(`Upload failed (${xhr.status}): ${body.error || xhr.statusText}`)
            }
          } catch {
            setUploadError(`Upload failed (${xhr.status}): ${xhr.statusText}`)
          }
        }
        setUploading(false)
        setUploadProgress(0)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      })

      xhr.addEventListener('error', () => {
        setUploadError('Network error — could not reach server. Check your connection.')
        setUploading(false)
        setUploadProgress(0)
      })

      xhr.open('POST', '/api/upload')
      xhr.send(formData)
    } catch (error) {
      console.error('Upload error:', error)
      setUploadError(error instanceof Error ? error.message : 'Upload failed')
      setUploading(false)
      setUploadProgress(0)
    }
  }

  // Generation is gated until every upload has settled and at least one file is
  // converted ('ready'). This lets the engine decide on the FULL set of files.
  const allSettled = files.length > 0 && files.every((f) => f.status === 'ready' || f.status === 'error')
  const someReady = files.some((f) => f.status === 'ready')
  const showGenerate = allSettled && someReady && !generating
  const isGenerating = generating || files.some((f) => f.status === 'generating_questions')

  return (
    <div className="space-y-6">
      <div className="rounded-card border border-border-hair bg-surface p-8">
        <h2 className="mb-6 font-display text-[18px] text-ink">New material</h2>

        {/* Role toggle — segmented control, active = teal-tinted */}
        <div className="mb-6">
          <p className="mb-3 text-sm text-ink-secondary">File type</p>
          <div className="inline-flex rounded-control border border-border-hair p-1">
            {(['theory', 'past_exam'] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setFileRole(role)}
                disabled={uploading}
                className={cn(
                  'rounded-control px-3 py-1.5 text-sm transition-colors duration-150',
                  fileRole === role ? 'bg-teal-800/20 text-teal-100' : 'text-ink-muted hover:text-ink-secondary'
                )}
              >
                {role === 'theory' ? 'Theory' : 'Past exam'}
              </button>
            ))}
          </div>
        </div>

        {/* Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={cn(
            'rounded-card border-2 border-dashed p-8 text-center transition-colors duration-150',
            dragActive ? 'border-teal-400 bg-teal-800/10' : 'border-border-hair',
            uploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.pptx"
            onChange={handleChange}
            disabled={uploading}
            className="hidden"
          />

          <div onClick={() => !uploading && fileInputRef.current?.click()}>
            <IconUpload size={40} stroke={1.5} className="mx-auto mb-3 text-teal-400" />
            <p className="mb-1 text-[15px] text-ink">Drag PDFs or PPTX here</p>
            <p className="text-sm text-ink-muted">or browse files</p>
            <p className="mt-2 text-xs text-ink-muted">Supported: PDF, PPTX (max 300MB)</p>
          </div>
        </div>

        {/* Upload Progress */}
        {uploading && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm text-ink-secondary">Uploading…</p>
              <span className="text-sm text-ink-muted tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset">
              <div
                className="h-full rounded-pill bg-teal-400 motion-safe:transition-[width] motion-safe:duration-tempo"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {uploadError && (
          <div className="mt-4 rounded-control bg-coral/10 p-3 text-sm text-coral-soft">
            {uploadError}
            <button onClick={() => setUploadError(null)} className="ml-2 text-xs underline hover:no-underline">
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* File Status List */}
      {files.length > 0 && (
        <div className="rounded-card border border-border-hair bg-surface p-6">
          <h3 className="mb-4 font-display text-ink">Upload status</h3>
          <div className="space-y-4">
            {files.map((f) => (
              <div key={f.id} className="rounded-control bg-surface-inset p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm text-ink">{f.name}</p>
                  {f.status === 'error' ? (
                    <IconX size={16} className="text-coral-soft" />
                  ) : f.status === 'done' ? (
                    <IconCheck size={16} className="text-gold" />
                  ) : null}
                </div>
                {f.status === 'error' ? (
                  <p className="text-xs text-coral-soft">✗ Error: {f.error || 'Unknown error'}</p>
                ) : (
                  <>
                    <StepTrack stage={toStage(f.status)} />
                    <div className="mt-1.5">
                      <StageLabel stage={toStage(f.status)} />
                    </div>
                    {/* A 'done' file can still carry a notice (e.g. open-ended
                        questions skipped). Not an error — the file succeeded. */}
                    {f.status === 'done' && f.error ? (
                      <p className="mt-1.5 text-xs text-ink-muted">ⓘ {f.error}</p>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Generate step — gated until all uploads are converted. */}
          {showGenerate && (
            <div className="mt-6 border-t border-border-hair pt-6">
              <p className="mb-3 text-sm text-ink-muted">
                {isExistingExam
                  ? 'New theory uploaded. This will process the material and re-attempt grounding for any previously unanswerable past-exam questions.'
                  : 'All files uploaded. Generate the quiz — past-exam questions are used as-is; AI questions are generated from theory only when no past exams were uploaded.'}
              </p>
              <Button variant="primary" className="w-full" onClick={() => { void handleGenerate() }}>
                {isExistingExam ? 'Add theory + recalibrate' : 'Generate quiz and flashcards'}
              </Button>
            </div>
          )}

          {isGenerating && !stalled && (
            <div className="mt-6 flex items-center gap-3 border-t border-border-hair pt-6 text-sm text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-coral border-t-transparent" />
              Generating questions… you&apos;ll be taken to the exam when it&apos;s ready.
            </div>
          )}

          {stalled && (
            <div className="mt-6 border-t border-border-hair pt-6">
              <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-secondary">
                <IconAlertTriangle size={14} className="text-coral-soft" />
                Taking longer than usual. This can happen if the server restarted mid-run.
              </p>
              <Button variant="primary" className="w-full" onClick={() => { void handleGenerate(true) }}>
                Retry generation
              </Button>
            </div>
          )}

          {processingStalled && (
            <div className="mt-6 border-t border-border-hair pt-6">
              <p className="text-sm text-ink-secondary">
                <IconAlertTriangle size={14} className="mr-1.5 inline text-coral-soft" />
                This file has been converting for a while and may have stopped. Upload it
                again to restart — the stuck copy can be deleted from the exam page.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
