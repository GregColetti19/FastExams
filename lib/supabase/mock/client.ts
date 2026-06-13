// Mock Supabase client. The query builder records a serializable QuerySpec and
// hands it to an injected executor — local (in-process store) on the server,
// remote (fetch → /api/dev-db) in the browser. Same builder, same semantics.

import { MockStore, Row, DEV_USER } from './store'
import {
  QuerySpec,
  FilterSpec,
  Result,
  StorageSpec,
  executeQuery,
  executeStorage,
} from './query'
import { bytesToB64, b64ToBytes } from './base64'

export type QueryExecutor = (spec: QuerySpec) => Promise<Result>
export type StorageExecutor = (spec: StorageSpec) => Promise<Result>

class QueryBuilder implements PromiseLike<Result> {
  private spec: QuerySpec
  private opSet = false

  constructor(table: string, private exec: QueryExecutor) {
    this.spec = { table, op: 'select', filters: [], single: false, wantSelect: false, limit: null }
  }

  select(_cols?: string): this {
    if (this.opSet) this.spec.wantSelect = true
    else this.spec.op = 'select'
    return this
  }
  insert(rows: Row | Row[]): this {
    this.spec.op = 'insert'
    this.opSet = true
    this.spec.payload = rows
    return this
  }
  update(obj: Row): this {
    this.spec.op = 'update'
    this.opSet = true
    this.spec.payload = obj
    return this
  }
  delete(): this {
    this.spec.op = 'delete'
    this.opSet = true
    return this
  }

  private filter(kind: FilterSpec['kind'], col: string, val: any): this {
    this.spec.filters.push({ kind, col, val })
    return this
  }
  eq(col: string, val: any) {
    return this.filter('eq', col, val)
  }
  lte(col: string, val: any) {
    return this.filter('lte', col, val)
  }
  gte(col: string, val: any) {
    return this.filter('gte', col, val)
  }
  in(col: string, vals: any[]) {
    return this.filter('in', col, vals)
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.spec.order = { col, asc: opts?.ascending !== false }
    return this
  }
  limit(n: number): this {
    this.spec.limit = n
    return this
  }
  single(): this {
    this.spec.single = true
    return this
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.exec(this.spec).then(onfulfilled, onrejected)
  }
}

function makeStorage(exec: StorageExecutor) {
  return {
    from(bucket: string) {
      return {
        async upload(path: string, body: ArrayBuffer | Uint8Array | Blob, _opts?: any): Promise<Result> {
          let bytes: Uint8Array
          if (body instanceof Uint8Array) bytes = body
          else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body)
          else bytes = new Uint8Array(await (body as Blob).arrayBuffer())
          const dataB64 = bytesToB64(bytes)
          return exec({ bucket, action: 'upload', path, dataB64 })
        },
        async download(path: string): Promise<Result> {
          const res = await exec({ bucket, action: 'download', path })
          if (res.error || !res.data) return { data: null, error: res.error ?? { message: 'Object not found' } }
          const bytes = b64ToBytes(res.data.dataB64)
          return { data: new Blob([bytes as unknown as BlobPart]), error: null }
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `mock://${bucket}/${path}` } }
        },
      }
    },
  }
}

/** Build a mock client from query + storage executors (executor-agnostic core). */
export function makeClient(queryExec: QueryExecutor, storageExec: StorageExecutor) {
  return {
    from(name: string) {
      return new QueryBuilder(name, queryExec)
    },
    storage: makeStorage(storageExec),
    auth: {
      async getUser(): Promise<Result> {
        return { data: { user: DEV_USER }, error: null }
      },
    },
  }
}

/** Local (server / test) client bound directly to an in-process store. */
export function createMockClient(store: MockStore) {
  return makeClient(
    async (spec) => executeQuery(store, spec),
    async (spec) => executeStorage(store, spec)
  )
}

export type MockClient = ReturnType<typeof createMockClient>
