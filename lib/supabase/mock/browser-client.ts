// Browser-side mock client. Forwards every query/storage op over fetch to
// /api/dev-db, which runs it against the shared file-backed server store. This
// is what makes the in-memory mock coherent for the running app: browser and
// server hit one store, not two.

import { makeClient } from './client'
import { QuerySpec, StorageSpec, Result } from './query'

async function post(body: { type: 'query'; spec: QuerySpec } | { type: 'storage'; spec: StorageSpec }): Promise<Result> {
  const res = await fetch('/api/dev-db', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { data: null, error: { message: `dev-db ${res.status}` } }
  return res.json()
}

export function createBrowserMockClient() {
  return makeClient(
    (spec) => post({ type: 'query', spec }),
    (spec) => post({ type: 'storage', spec })
  )
}
