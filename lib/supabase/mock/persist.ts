// Server-only file-backed store. Imports node:fs, so never import this from
// browser code — the browser talks to the store via /api/dev-db instead.
//
// Returns the SAME singleton as getMockStore(), so server code, the dev-db
// route, and tests all share one store. File persistence is attached only when
// DEV_DB_PERSIST=1 (set by the dev scripts). Tests leave it unset, so they run
// purely in memory with no disk IO.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getMockStore, MockStore } from './store'
import { makeClient } from './client'
import { executeQuery } from './query'
import { executeFileStorage } from './file-storage'

export const DEV_DB_PATH = process.env.DEV_DB_PATH || '.dev-data/db.json'

// Only TABLES go in db.json (small, fast to (de)serialize). Uploaded blobs live
// as separate files via file-storage — keeping multi-MB binaries out of db.json.
function save(store: MockStore): void {
  mkdirSync(dirname(DEV_DB_PATH), { recursive: true })
  writeFileSync(DEV_DB_PATH, JSON.stringify({ tables: store.dumpTables() }, null, 2))
}

export function getFileStore(): MockStore {
  const store = getMockStore()
  if (process.env.DEV_DB_PERSIST === '1') {
    // Reload tables from disk on every call. Next dev gives separate route
    // modules their own store singleton, so disk is the single source of truth.
    // db.json is now tables-only, so this is cheap. Every mutation saves
    // synchronously, so the file is always current.
    if (existsSync(DEV_DB_PATH)) {
      try {
        store.loadTables(JSON.parse(readFileSync(DEV_DB_PATH, 'utf8')).tables ?? {})
      } catch {
        // Corrupt file — start empty rather than crash the dev server.
      }
    }
    store.onMutate = () => save(store)
  }
  return store
}

/**
 * Server mock client: tables from the file-backed store, storage from on-disk
 * blob files (not base64 in db.json). Reloads tables once per request.
 */
export function createFileMockClient() {
  const store = getFileStore()
  return makeClient(
    async (spec) => executeQuery(store, spec),
    async (spec) => executeFileStorage(spec)
  )
}
