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

    const { checkSchema } = await import('./lib/supabase/schema-check')
    await checkSchema()
  }
}
