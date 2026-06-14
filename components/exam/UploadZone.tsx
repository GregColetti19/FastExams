'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FileRole, ProcessingStatus } from '@/types'

interface UploadZoneProps {
  examId: string
}

export function UploadZone({ examId }: UploadZoneProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [fileRole, setFileRole] = useState<FileRole>('theory')
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [files, setFiles] = useState<Array<{ id: string; name: string; status: ProcessingStatus; error?: string }>>([])
  const [pollInterval, setPollInterval] = useState<number | null>(null)
  const supabase = createClient()

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
        const generated = updatedFiles.every((f) => f.status === 'done' || f.status === 'error')
        if (generated && updatedFiles.some((f) => f.status === 'done')) {
          router.push(`/exam/${examId}`)
        }
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [pollInterval, files, supabase, router, examId])

  const handleGenerate = async () => {
    setGenerating(true)
    setUploadError(null)
    try {
      const res = await fetch('/api/generate-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Generation failed (${res.status})`)
      }
      // Optimistically flip ready files to generating, then resume polling.
      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'ready' ? { ...f, status: 'generating_questions' as ProcessingStatus } : f
        )
      )
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
          setPollInterval(2000) // Start polling
        } else {
          try {
            const body = JSON.parse(xhr.responseText)
            setUploadError(`Upload failed (${xhr.status}): ${body.error || xhr.statusText}`)
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
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8">
        <h2 className="text-2xl font-semibold text-slate-900 mb-6">Upload Study Material</h2>

        {/* File Role Toggle */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-3">File Type</label>
          <div className="flex gap-4">
            {(['theory', 'past_exam'] as const).map((role) => (
              <label key={role} className="flex items-center">
                <input
                  type="radio"
                  name="fileRole"
                  value={role}
                  checked={fileRole === role}
                  onChange={(e) => setFileRole(e.target.value as FileRole)}
                  disabled={uploading}
                  className="mr-2"
                />
                <span className="text-sm text-slate-700">
                  {role === 'theory' ? 'Theory Material' : 'Past Exam Paper'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
          } ${uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
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
            <svg
              className="mx-auto h-12 w-12 text-slate-400 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>

            <p className="text-lg font-medium text-slate-900 mb-1">Drag and drop your file here</p>
            <p className="text-sm text-slate-600">or click to select from your computer</p>
            <p className="text-xs text-slate-500 mt-2">Supported: PDF, PPTX (max 300MB)</p>
          </div>
        </div>

        {/* Upload Progress */}
        {uploading && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <p className="text-sm font-medium text-slate-700">Uploading...</p>
              <span className="text-sm text-slate-600">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {uploadError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {uploadError}
            <button
              onClick={() => setUploadError(null)}
              className="ml-2 text-red-500 underline text-xs hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* File Status List */}
      {files.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Upload Status</h3>
          <div className="space-y-3">
            {files.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{f.name}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    {f.status === 'pending' && 'Waiting to process...'}
                    {f.status === 'processing' && 'Converting file...'}
                    {f.status === 'ready' && '✓ Uploaded — ready to generate'}
                    {f.status === 'generating_questions' && 'Generating questions...'}
                    {f.status === 'done' && '✓ Complete'}
                    {f.status === 'error' && `✗ Error: ${f.error || 'Unknown error'}`}
                  </p>
                </div>
                <div>
                  {f.status === 'pending' && <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
                  {f.status === 'processing' && <div className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />}
                  {f.status === 'ready' && <span className="text-slate-400 font-bold">✓</span>}
                  {f.status === 'generating_questions' && <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />}
                  {f.status === 'done' && <span className="text-green-600 font-bold">✓</span>}
                  {f.status === 'error' && <span className="text-red-600 font-bold">✗</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Generate step — gated until all uploads are converted. */}
          {showGenerate && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <p className="text-sm text-slate-600 mb-3">
                All files uploaded. Generate the quiz — past-exam questions are used as-is;
                AI questions are generated from theory only when no past exams were uploaded.
              </p>
              <button
                onClick={handleGenerate}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
              >
                Generate Quiz
              </button>
            </div>
          )}

          {isGenerating && (
            <div className="mt-6 pt-6 border-t border-slate-200 flex items-center gap-3 text-sm text-slate-600">
              <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
              Generating questions… you’ll be taken to the exam when it’s ready.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
