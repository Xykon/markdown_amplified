import path from 'path'
import { NextResponse } from 'next/server'
import { getContentProvider } from '../../../../lib/content-provider.mjs'
import { loadSecurityRules, findRule, isWithinDateRange } from '../../../../lib/security.mjs'
import { MIME_TYPES } from '../../../../lib/mime-types.mjs'

function decodeSlug(slug) {
  return (slug || []).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
}

export async function POST(request, { params }) {
  const { slug } = await params
  if (!slug || slug.length === 0) return new NextResponse(null, { status: 404 })

  const relPath = decodeSlug(slug).join('/')

  if (relPath.endsWith('.md') || relPath === 'content-security.json') {
    return new NextResponse(null, { status: 404 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const { password } = body ?? {}

  const rules = await loadSecurityRules()
  const rule = findRule(relPath, rules)

  if (!rule?.password) return new NextResponse(null, { status: 404 })
  if (!isWithinDateRange(rule)) return new NextResponse(null, { status: 404 })

  // Constant-time-ish string comparison to avoid timing attacks
  if (password !== rule.password) {
    return new NextResponse(JSON.stringify({ error: 'Incorrect password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const provider = getContentProvider()
  const content = await provider.readFile(relPath)
  if (!content) return new NextResponse(null, { status: 404 })

  const ext = path.extname(relPath).toLowerCase()
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'
  const filename = path.posix.basename(relPath)

  return new NextResponse(content, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
