// Serializable query spec + pure executor shared by the local (server) and
// remote (browser→/api/dev-db) mock clients. Keeping the query as plain data
// (not closures) lets the browser POST it to the server, so both sides run the
// exact same PostgREST-like semantics against one shared store.

import { MockStore, Row } from './store'
import { bytesToB64, b64ToBytes } from './base64'

export type FilterKind = 'eq' | 'lte' | 'gte' | 'in'
export interface FilterSpec {
  kind: FilterKind
  col: string
  val: any
}

export interface QuerySpec {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  payload?: Row | Row[]
  filters: FilterSpec[]
  order?: { col: string; asc: boolean }
  limit?: number | null
  single: boolean
  wantSelect: boolean
}

export type Result<T = any> = {
  data: T
  error: { message: string; code?: string } | null
}

function matches(row: Row, f: FilterSpec): boolean {
  switch (f.kind) {
    case 'eq':
      return row[f.col] === f.val
    case 'lte':
      return row[f.col] <= f.val
    case 'gte':
      return row[f.col] >= f.val
    case 'in':
      return Array.isArray(f.val) && f.val.includes(row[f.col])
  }
}

function applyFilters(rows: Row[], filters: FilterSpec[]): Row[] {
  return rows.filter((r) => filters.every((f) => matches(r, f)))
}

function finalizeRead(rows: Row[], spec: QuerySpec): Result {
  let out = [...rows]
  if (spec.order) {
    const { col, asc } = spec.order
    out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
  }
  if (spec.limit != null) out = out.slice(0, spec.limit)
  if (spec.single) {
    if (out.length === 1) return { data: out[0], error: null }
    return { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${out.length}` } }
  }
  return { data: out, error: null }
}

export function executeQuery(store: MockStore, spec: QuerySpec): Result {
  const rows = store.table(spec.table)

  if (spec.op === 'select') {
    return finalizeRead(applyFilters(rows, spec.filters), spec)
  }

  if (spec.op === 'insert') {
    const incoming = Array.isArray(spec.payload) ? spec.payload : [spec.payload as Row]
    const inserted = incoming.map((r) => store.withDefaults(spec.table, r))
    rows.push(...inserted)
    store.onMutate?.()
    if (!spec.wantSelect) return { data: null, error: null }
    return spec.single ? { data: inserted[0] ?? null, error: null } : { data: inserted, error: null }
  }

  if (spec.op === 'update') {
    const targets = applyFilters(rows, spec.filters)
    targets.forEach((r) => Object.assign(r, spec.payload))
    store.onMutate?.()
    if (!spec.wantSelect) return { data: null, error: null }
    return spec.single ? { data: targets[0] ?? null, error: null } : { data: targets, error: null }
  }

  // delete
  const keep = rows.filter((r) => !spec.filters.every((f) => matches(r, f)))
  store.tables.set(spec.table, keep)
  store.onMutate?.()
  return { data: null, error: null }
}

// --- storage ops (also serializable for the browser shim) ----------------

export interface StorageSpec {
  bucket: string
  action: 'upload' | 'download'
  path: string
  dataB64?: string
}

export function executeStorage(store: MockStore, spec: StorageSpec): Result {
  const key = `${spec.bucket}/${spec.path}`
  if (spec.action === 'upload') {
    store.storage.set(key, spec.dataB64 ? b64ToBytes(spec.dataB64) : new Uint8Array())
    store.onMutate?.()
    return { data: { path: spec.path }, error: null }
  }
  // download → return base64 so it survives JSON transport
  const bytes = store.storage.get(key)
  if (!bytes) return { data: null, error: { message: 'Object not found' } }
  return { data: { dataB64: bytesToB64(bytes) }, error: null }
}
