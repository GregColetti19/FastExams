import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Dev mode: skip all auth
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
