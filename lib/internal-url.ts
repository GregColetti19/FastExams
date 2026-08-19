/**
 * Base URL for server-to-server calls the app makes to itself.
 *
 * NOT request.nextUrl.origin: behind a proxy that terminates TLS (Railway,
 * Vercel), origin reports the public https:// URL while the container itself
 * only listens on plain HTTP. Fetching that origin leaves the container,
 * crosses the proxy and comes back — and when the hostname resolves to an
 * HTTP-only port, the TLS handshake reads an HTTP response as a TLS record
 * and fails with ERR_SSL_PACKET_LENGTH_TOO_LONG.
 *
 * Loopback skips DNS, TLS and the proxy: the server is the one making the
 * call and the one answering it.
 */
export function internalBaseUrl(): string {
  // ponytail: PORT is set by the platform; 3000 is Next's default for local dev.
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`
}
