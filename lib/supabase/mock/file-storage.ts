// Server-only file-backed storage for the mock DB. Uploaded bytes are written
// as individual blob files under .dev-data/storage/ — NOT base64-encoded inside
// db.json. Keeping large binaries out of db.json is what makes the mock fast:
// otherwise every table mutation would re-serialize a multi-MB JSON file.
//
// Imports node:fs, so never import from browser code.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { StorageSpec, Result } from './query'
import { bytesToB64, b64ToBytes } from './base64'

function storageDir(): string {
  const dbPath = process.env.DEV_DB_PATH || '.dev-data/db.json'
  return join(dirname(dbPath), 'storage')
}

function keyToPath(bucket: string, path: string): string {
  // Encode the whole key into one safe filename (no nested dirs to manage).
  return join(storageDir(), encodeURIComponent(`${bucket}/${path}`))
}

export function executeFileStorage(spec: StorageSpec): Result {
  const file = keyToPath(spec.bucket, spec.path)

  if (spec.action === 'upload') {
    mkdirSync(storageDir(), { recursive: true })
    writeFileSync(file, b64ToBytes(spec.dataB64 ?? ''))
    return { data: { path: spec.path }, error: null }
  }

  // download
  if (!existsSync(file)) return { data: null, error: { message: 'Object not found' } }
  return { data: { dataB64: bytesToB64(new Uint8Array(readFileSync(file))) }, error: null }
}

/** Remove all stored blobs (used when resetting dev data). */
export function clearFileStorage(): void {
  rmSync(storageDir(), { recursive: true, force: true })
}
