import { NextResponse } from 'next/server'
import { DEBUG, dbg } from './lib/logger.mjs'

// Log every inbound request to stdout → CloudWatch in production, terminal in dev.
// Response status is not available in middleware (runs before the handler),
// so we log what we can: method, path, IP, referrer, user-agent.
export function middleware(request) {
  const { method, nextUrl } = request
  const path = nextUrl.pathname + (nextUrl.search || '')
  const ip  = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '-'
  const ref = request.headers.get('referer') ?? '-'
  const ua  = request.headers.get('user-agent') ?? '-'

  console.log(`[req] ${method} ${path} | ip=${ip} ref=${ref} | ${ua}`)

  if (DEBUG) {
    const rid   = request.headers.get('x-amzn-trace-id') ?? '-'
    const host  = request.headers.get('host') ?? '-'
    const proto = request.headers.get('x-forwarded-proto') ?? '-'
    const via   = request.headers.get('via') ?? '-'
    dbg(`trace=${rid} host=${host} proto=${proto} via=${via}`)
    // Log any x-amz-* / x-amzn-* / x-forwarded-* headers present
    const extra = []
    for (const [k, v] of request.headers) {
      if (/^x-am[sz]n?-/i.test(k) || k === 'cf-ray') extra.push(`${k}=${v}`)
    }
    if (extra.length) dbg('aws-headers:', extra.join(' '))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Skip Next.js internals and static assets – they are served by CloudFront
    // directly and never reach the Lambda / Node.js server anyway.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
