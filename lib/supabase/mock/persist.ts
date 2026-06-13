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

export const DEV_DB_PATH = process.env.DEV_DB_PATH || '.dev-data/db.json'

let initialized = false

function save(store: MockStore): void {
  mkdirSync(dirname(DEV_DB_PATH), { recursive: true })
  writeFileSync(DEV_DB_PATH, JSON.stringify({ tables: store.dumpTables() }, null, 2))
}

export function getFileStore(): MockStore {
  const store = getMockStore()
  if (process.env.DEV_DB_PERSIST === '1' && !initialized) {
    initialized = true
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
