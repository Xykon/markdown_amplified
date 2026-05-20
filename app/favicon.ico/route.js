import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { getContentProvider } from '../../lib/content-provider.mjs'

const HEADERS = {
  'Content-Type': 'image/x-icon',
  // Cache for 24 h at the browser; CloudFront will respect this too.
  'Cache-Control': 'public, max-age=86400',
}

export async function GET() {
  // 1. Try the active content provider (S3 bucket or local content dir).
  try {
    const provider = getContentProvider()
    const buf = await provider.readFile('favicon.ico')
    if (buf?.length) return new NextResponse(buf, { status: 200, headers: HEADERS })
  } catch { /* provider unavailable or file absent — fall through */ }

  // 2. Fall back to the built-in default shipped with the app.
  try {
    const defaultPath = path.join(process.cwd(), 'content.default', 'favicon.ico')
    const buf = fs.readFileSync(defaultPath)
    return new NextResponse(buf, { status: 200, headers: HEADERS })
  } catch { /* no default either */ }

  return new NextResponse(null, { status: 404 })
}
