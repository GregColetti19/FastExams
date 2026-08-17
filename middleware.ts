import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that require a signed-in user. Everything not matched here (auth pages,
// static assets, /api/dev-db) is left alone by the matcher below.
export async function middleware(request: NextRequest) {
  // DB_MODE=mock has no real auth (mock client returns a canned user), so the
  // gate would redirect forever. Local mock dev stays open.
  if (process.env.DB_MODE === 'mock') return NextResponse.next()

  // Internal server-to-server calls (upload → process-file, generate-exam →
  // generate-questions / recalibrate) run detached in setImmediate after the
  // response is sent, so they carry no session cookie and no user exists to
  // borrow one from. They authenticate with a shared secret instead.
  const internalSecret = process.env.INTERNAL_API_SECRET
  if (internalSecret && request.headers.get('x-internal-secret') === internalSecret) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write refreshed tokens onto both the request (for downstream
          // handlers in this pass) and the response (for the browser).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() revalidates against Supabase and refreshes the session cookie.
  // Do not swap for getSession(), which trusts unverified cookie contents.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // API routes get a 401 — a redirect to an HTML login page would surface in
    // fetch callers as an unparseable success.
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    // '/' is intentionally absent: it renders a public landing page that
    // redirects signed-in visitors to /dashboard itself.
    '/dashboard/:path*',
    '/exam/:path*',
    '/quiz/:path*',
    '/flashcards/:path*',
    '/review/:path*',
    '/analytics/:path*',
    // API routes except the mock-only dev-db endpoint, which 404s on its own
    // when DB_MODE isn't mock.
    '/api/((?!dev-db).*)',
  ],
}
