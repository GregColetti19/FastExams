# Deploying FastExams

Two services on Railway from one repo: the Next.js app and the Python converter.

Why a container host rather than Vercel: ingestion is synchronous and budgets
20 minutes per file (`app/api/generate-exam/route.ts`), and `/api/upload` does
its work in `setImmediate` *after* the response is sent. Serverless kills the
function at 5 minutes and freezes the process once a response goes out, so both
would break. See the "Architecture constraints" section at the bottom.

---

`.env.production.example` lists every variable each service needs, grouped by
service and annotated. Copy from there into the Railway dashboard; the tables
below are the same values in walkthrough order.

## 0. Before you start

- Push the branch: Railway deploys from GitHub, not from your laptop.
- Have the Supabase project ready (see `supabase/migrations/README.md`).
- Generate two secrets, each a different value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

One becomes `INTERNAL_API_SECRET`, the other `CONVERTER_SECRET`.

---

## 1. Create the project and the converter service

Deploy the converter **first** — the app needs its hostname.

1. railway.app → New Project → Deploy from GitHub repo → this repo.
2. Service Settings → **Root Directory**: `converter`
3. Build picks up `converter/railway.json` → `converter/Dockerfile`.
4. Variables:

   | Variable | Value |
   |---|---|
   | `CONVERTER_SECRET` | your second generated secret |

5. Settings → Networking: leave **private**. Do not generate a public domain.
   Nothing outside Railway should reach `/convert`.
6. Copy the private hostname, e.g. `converter.railway.internal`, and note the
   port Railway shows for the service. Railway injects `PORT` and the container
   binds to it; the Dockerfile deliberately does not hardcode one. If the
   dashboard shows no port, set `PORT=8001` on the converter service explicitly
   and use that in step 2.

The first build takes a while — Docling's ML wheels are large and the image
lands around 2GB. `healthcheckTimeout` is set to 300s for that reason.

---

## 2. Create the app service

1. Same project → New → GitHub repo → this repo again.
2. **Root Directory**: leave empty (repo root). Picks up `railway.json`.
3. Variables:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase → Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
   | `SUPABASE_SERVICE_ROLE_KEY` | same page — server-side only, never `NEXT_PUBLIC_` |
   | `INTERNAL_API_SECRET` | your first generated secret |
   | `CONVERTER_SECRET` | **same value as the converter service** |
   | `CONVERTER_SERVICE_URL` | `http://converter.railway.internal:<port from step 1.6>` |
   | `MAX_FILE_SIZE_MB` | `50` |
   | `NEXT_PUBLIC_MAX_FILE_SIZE_MB` | `50` |
   | `DAILY_UPLOAD_BUDGET_MB` | `200` |
   | `ANTHROPIC_API_KEY` / `OPEN_ROUTER_API_KEY` | fresh keys, not the ones in your local `.env.local` |

   Plus whichever `AI_PROVIDER` / `AI_MODEL_*` / `EMBED_*` values you run — see
   `.env.local.example`.

4. Settings → Networking → **Generate Domain**. This is the tester URL.

`CONVERTER_SERVICE_URL` uses `http://` and the internal hostname on purpose:
private-network traffic inside Railway, never over the public internet.

---

## 3. Verify

```bash
curl https://<your-app>.up.railway.app/api/health          # {"status":"ok"}
curl -o /dev/null -w "%{http_code}\n" -X POST \
     https://<your-app>.up.railway.app/api/upload          # 401
curl -o /dev/null -w "%{http_code}\n" \
     https://<your-app>.up.railway.app/dashboard           # 307 -> /login
```

Then check the deploy logs. `INTERNAL_API_SECRET` missing or the two file-size
variables disagreeing both log a warning at boot from `instrumentation.ts`.

Confirm the converter has **no** public domain.

---

## 4. First real run

Sign up, create an exam, upload a small PDF (5–10MB). Watch the app logs.

Where it can stall:

| Symptom | Cause |
|---|---|
| File stuck at `pending` | `INTERNAL_API_SECRET` missing or mismatched — middleware is rejecting the detached `process-file` call |
| Converter 401 in logs | `CONVERTER_SECRET` differs between the two services |
| Upload 413 | Supabase bucket per-file limit below `MAX_FILE_SIZE_MB` |
| Upload rejected instantly, "limit is 50MB" | working as intended |

---

## Build notes

**`npm install`, not `npm ci`.** `npm ci` deletes `node_modules` wholesale
before installing, and Railway mounts its build cache at
`/app/node_modules/.cache`. That mount is busy, the rmdir fails, and the build
dies with `EBUSY: resource busy or locked`. `npm install` updates in place and
is still deterministic with a committed lockfile. Do not "fix" this back to
`npm ci` — it will break the deploy again.

**Node is pinned to >=22.19.0** (`.nvmrc`, `engines` in package.json).
`undici@8` requires it, and Railway otherwise resolves 22.14.0, which trips
`EBADENGINE`. undici is not optional: `instrumentation.ts` uses it to raise the
fetch timeout from its 300s default to 30 minutes, which the ingestion pipeline
needs.

## Architecture constraints

**Single replica, deliberately.** `numReplicas: 1` in both `railway.json`
files. `/api/upload` returns 201 and then calls `/api/process-file` from
`setImmediate`; with two replicas that call can land on an instance that knows
nothing about the upload.

**Deploys interrupt ingestion.** A restart mid-pipeline drops the detached job
and leaves the file at `pending` or `generating_questions`. The upload UI
detects both and offers a retry, but the cleanest fix is not deploying while
someone is mid-upload.

**A job queue is the real fix** for both of the above, and is deliberately not
built — wrong investment for ten testers. Revisit if ingestion proves flaky
under real use, when you'll know the actual failure rate.
