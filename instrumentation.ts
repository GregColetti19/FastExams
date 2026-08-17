function patchConsole() {
  const ts = () => new Date().toISOString()
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => orig(`[${ts()}]`, ...args)
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    patchConsole()

    // Undici (Node fetch) default headersTimeout = 300s, too short for AI pipeline.
    const { setGlobalDispatcher, Agent } = await import('undici')
    setGlobalDispatcher(new Agent({ headersTimeout: 30 * 60 * 1000, bodyTimeout: 30 * 60 * 1000 }))

    // Fail loud at boot, not silently at the first upload: without this secret
    // the detached internal calls (process-file, generate-questions,
    // recalibrate) are rejected by middleware and ingestion stalls at 'pending'.
    if (process.env.DB_MODE !== 'mock' && !process.env.INTERNAL_API_SECRET) {
      console.error(
        '[config] INTERNAL_API_SECRET is not set. Internal server-to-server calls ' +
          'will be rejected by middleware and file processing will never start. ' +
          'Set it to any long random string (same value for the whole deployment).'
      )
    }

    // The server enforces MAX_FILE_SIZE_MB; the upload UI pre-checks against
    // NEXT_PUBLIC_MAX_FILE_SIZE_MB. If they drift, files either upload in full
    // only to be rejected, or get blocked client-side that the server allows.
    const serverMax = process.env.MAX_FILE_SIZE_MB || '50'
    const clientMax = process.env.NEXT_PUBLIC_MAX_FILE_SIZE_MB || '50'
    if (serverMax !== clientMax) {
      console.warn(
        `[config] MAX_FILE_SIZE_MB (${serverMax}) != NEXT_PUBLIC_MAX_FILE_SIZE_MB ` +
          `(${clientMax}). Set both to the same value — and no higher than the ` +
          `storage bucket's per-file limit (50MB on the Supabase free tier).`
      )
    }

    const { checkSchema } = await import('./lib/supabase/schema-check')
    await checkSchema()
  }
}
