// Browser-safe: must NOT import node:fs (this is bundled into client code).
// Server uses getFileStore() from ./mock/persist; browser uses
// createBrowserMockClient() from ./mock/browser-client.

/**
 * True when mock mode is on — use the in-memory/file-backed store, no cloud.
 * Checks NEXT_PUBLIC_DB_MODE too because the browser bundle only sees
 * NEXT_PUBLIC_* env vars at runtime (server code can use either).
 */
export function isMockDb(): boolean {
  return process.env.DB_MODE === 'mock' || process.env.NEXT_PUBLIC_DB_MODE === 'mock'
}
