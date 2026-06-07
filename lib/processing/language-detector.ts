// @ts-ignore - franc doesn't have types
import { franc } from 'franc'

// Map ISO 639-3 codes to ISO 639-1 codes and human-readable names
const CODE_TO_LANGUAGE: Record<string, { code: string; name: string }> = {
  eng: { code: 'en', name: 'English' },
  deu: { code: 'de', name: 'German' },
  fra: { code: 'fr', name: 'French' },
  spa: { code: 'es', name: 'Spanish' },
  ita: { code: 'it', name: 'Italian' },
  por: { code: 'pt', name: 'Portuguese' },
  rus: { code: 'ru', name: 'Russian' },
  jpn: { code: 'ja', name: 'Japanese' },
  zho: { code: 'zh', name: 'Chinese' },
  kor: { code: 'ko', name: 'Korean' },
  arb: { code: 'ar', name: 'Arabic' },
  nld: { code: 'nl', name: 'Dutch' },
  swe: { code: 'sv', name: 'Swedish' },
  nor: { code: 'no', name: 'Norwegian' },
  dan: { code: 'da', name: 'Danish' },
  fin: { code: 'fi', name: 'Finnish' },
  pol: { code: 'pl', name: 'Polish' },
  grk: { code: 'el', name: 'Greek' },
  tur: { code: 'tr', name: 'Turkish' },
  heb: { code: 'he', name: 'Hebrew' },
}

export interface LanguageDetectionResult {
  code: string
  name: string
  confidence: number
}

export function detectLanguage(text: string, minLength: number = 100): LanguageDetectionResult {
  // Take first 500 characters for detection
  const sample = text.slice(0, 500).trim()

  if (sample.length < minLength) {
    return { code: 'en', name: 'English', confidence: 0 }
  }

  try {
    const iso639_3 = franc(sample, { minLength: 1 })

    if (iso639_3 === 'und') {
      // Undetermined
      return { code: 'en', name: 'English', confidence: 0 }
    }

    const mapped = CODE_TO_LANGUAGE[iso639_3]
    if (mapped) {
      return { code: mapped.code, name: mapped.name, confidence: 0.8 }
    }

    // Fallback to English if unknown language detected
    return { code: 'en', name: 'English', confidence: 0 }
  } catch {
    return { code: 'en', name: 'English', confidence: 0 }
  }
}
