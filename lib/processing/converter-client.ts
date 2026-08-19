const CONVERTER_URL = process.env.CONVERTER_SERVICE_URL || 'http://localhost:8001'

// ponytail: generous enough for a large PDF on a cold service, short enough that
// a misconfigured URL surfaces as an error instead of an endless spinner.
const CONVERT_TIMEOUT_MS = 120_000
const HEALTH_TIMEOUT_MS = 5_000

export interface ConverterResponse {
  markdown: string
  images: Array<{ page: number; data: string; mime_type: string }>
  converter_used: 'markitdown' | 'docling'
}

export async function convertFile(
  fileBuffer: Buffer,
  fileType: 'pdf' | 'pptx'
): Promise<ConverterResponse> {
  try {
    const formData = new FormData()
    const uint8array = new Uint8Array(fileBuffer)
    const blob = new Blob([uint8array], {
      type: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    formData.append('file', blob, `file.${fileType}`)
    formData.append('file_type', fileType)

    // Without a deadline an unreachable converter leaves the request hanging
    // forever: process-file never throws, never reaches its catch, and the file
    // sits at 'processing' with no error and nothing in the logs. Fail loudly
    // instead so the status row and the UI both show what happened.
    const response = await fetch(`${CONVERTER_URL}/convert`, {
      method: 'POST',
      // Matches CONVERTER_SECRET on the converter service. Empty locally, where
      // the service leaves the endpoint open.
      headers: { 'x-converter-secret': process.env.CONVERTER_SECRET ?? '' },
      body: formData,
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Converter returned ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    // Name the URL: the two ways this fails in production (unset env var ->
    // localhost, or an unreachable private-network host) are indistinguishable
    // from the bare abort/connect message alone.
    const detail =
      error instanceof Error && error.name === 'TimeoutError'
        ? `No response from ${CONVERTER_URL} within ${CONVERT_TIMEOUT_MS}ms`
        : error instanceof Error
          ? `${error.message} (${CONVERTER_URL})`
          : String(error)
    console.error('Converter service error:', detail, error)
    throw {
      error: 'Converter service unavailable',
      code: 'CONVERTER_OFFLINE',
      details: detail,
    }
  }
}

export async function checkConverterHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${CONVERTER_URL}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}
