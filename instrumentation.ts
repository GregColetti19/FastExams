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

    const { checkSchema } = await import('./lib/supabase/schema-check')
    await checkSchema()
  }
}
