import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Routes that require authentication
  const protectedRoutes = ['/dashboard', '/exam', '/quiz', '/review', '/flashcards']
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route))

  if (!isProtectedRoute) {
    return NextResponse.next()
  }

  // Check for Supabase session cookie
  const supabaseSession = request.cookies.get('sb-access-token')

  if (!supabaseSession) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|signup).*)',
  ],
}
