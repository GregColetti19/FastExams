const CONVERTER_URL = process.env.CONVERTER_SERVICE_URL || 'http://localhost:8001'

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
    const blob = new Blob([fileBuffer], {
      mimeType: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    formData.append('file', blob, `file.${fileType}`)
    formData.append('file_type', fileType)

    const response = await fetch(`${CONVERTER_URL}/convert`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Converter returned ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Converter service error:', error)
    throw {
      error: 'Converter service unavailable',
      code: 'CONVERTER_OFFLINE',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function checkConverterHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${CONVERTER_URL}/health`)
    return response.ok
  } catch {
    return false
  }
}
