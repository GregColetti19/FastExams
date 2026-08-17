# Migrations

Two paths. Pick one.

## Fresh project (alpha / new deployment)

Run **`000_schema.sql`** alone, in the Supabase SQL Editor. It is the complete
end state consolidated from 001–014: tables with final columns and FK rules,
indexes, the `match_chunks` RPC, the signup trigger, and RLS enabled with all
policies.

Ignore every numbered file. Do **not** run them after it.

It creates nothing destructively (no `DROP TABLE`) and is safe to re-run.

### Storage bucket

The schema does not create it. In Storage, add a **private** bucket named
`uploads` with a per-file limit of **50MB** — the free-tier ceiling, and the
value `MAX_FILE_SIZE_MB` / `NEXT_PUBLIC_MAX_FILE_SIZE_MB` must match. Setting
the app limit higher makes oversized files upload in full before failing at
storage with a 413.

## Existing project

Keep applying the numbered migrations in order from wherever you are.
`000_schema.sql` creates, it does not migrate — it will not alter tables that
already exist.

## `003_disable_rls_dev.sql` — never run this on a shared database

It disables row level security on all ten tables, which was fine when the app
was single-user local development. On a deployment with more than one account it
lets any signed-in user read and write everyone else's exams, questions and
study history.

It is kept only because the numbered sequence is the history of an existing
database. `000_schema.sql` deliberately omits it.

## Verifying RLS is on

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' ORDER BY tablename;
```

Every row must show `rowsecurity = true`. If any is false, the app will serve
one user's data to another.
