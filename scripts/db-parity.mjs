#!/usr/bin/env node
// Diff the dev and live Supabase projects. Dev and live must differ ONLY by the
// auth bypass (an app-level env flag), never by schema or policy — the storage
// 403 reached production precisely because dev could not reproduce live's rules.
//
// Usage: npm run db:parity      (needs SUPABASE_ACCESS_TOKEN in .env.local)
// Exits 1 on any difference, so it can gate CI.

import { readFileSync } from 'node:fs'

const DEV = 'zwyhbjkqxwpqecpabhbs'
const LIVE = 'smkuscpfrzmewsijlefb'

// Differences that are expected and allowed. Everything else is drift.
const ALLOWED = [
  // Dev has an extra bucket that live never created. Harmless: no code writes
  // to it, and dev's storage policies cover both buckets.
  { kind: 'buckets', value: 'images' },
]

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN missing (expected in .env.local)')
  process.exit(2)
}

async function q(project, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) throw new Error(`${project}: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

const CHECKS = {
  columns: "select table_name||'.'||column_name as v from information_schema.columns where table_schema='public' order by 1",
  rls: "select relname||'='||relrowsecurity::text as v from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1",
  policies: "select tablename||'::'||policyname||'['||cmd||']' as v from pg_policies where schemaname='public' order by 1",
  storage_policies: "select policyname||'['||cmd||']' as v from pg_policies where schemaname='storage' order by 1",
  functions: "select proname as v from pg_proc where pronamespace='public'::regnamespace and proname in ('is_admin','match_chunks','handle_new_user') order by 1",
  buckets: "select id||'(public='||public::text||')' as v from storage.buckets order by 1",
}

const allowed = (kind, value) =>
  ALLOWED.some((a) => a.kind === kind && value.includes(a.value))

let failed = false
console.log(`dev  = ${DEV}\nlive = ${LIVE}\n`)

for (const [name, sql] of Object.entries(CHECKS)) {
  const [d, l] = await Promise.all([q(DEV, sql), q(LIVE, sql)])
  const dv = new Set(d.map((r) => r.v))
  const lv = new Set(l.map((r) => r.v))
  const onlyDev = [...dv].filter((x) => !lv.has(x) && !allowed(name, x))
  const onlyLive = [...lv].filter((x) => !dv.has(x) && !allowed(name, x))

  if (!onlyDev.length && !onlyLive.length) {
    console.log(`  ${name.padEnd(18)} OK   (${dv.size})`)
    continue
  }
  failed = true
  console.log(`  ${name.padEnd(18)} DRIFT`)
  onlyDev.forEach((x) => console.log(`      only on dev : ${x}`))
  onlyLive.forEach((x) => console.log(`      only on live: ${x}`))
}

console.log(failed ? '\nFAIL — dev and live have drifted.' : '\nOK — dev matches live.')
process.exit(failed ? 1 : 0)
