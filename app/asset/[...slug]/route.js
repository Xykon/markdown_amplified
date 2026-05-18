import path from 'path'
import { NextResponse } from 'next/server'
import { getContentProvider } from '../../../lib/content-provider.mjs'
import { loadSecurityRules, findRule, isWithinDateRange } from '../../../lib/security.mjs'
import { MIME_TYPES } from '../../../lib/mime-types.mjs'

function decodeSlug(slug) {
  return (slug || []).map((s) => {
    try { return decodeURIComponent(s) } catch { return s }
  })
}

export async function GET(request, { params }) {
  const { slug } = await params
  if (!slug || slug.length === 0) return new NextResponse(null, { status: 404 })

  const relPath = decodeSlug(slug).join('/')

  // Markdown files are served as pages, not assets.
  // content-security.json contains passwords and must never be exposed.
  if (relPath.endsWith('.md') || relPath === 'content-security.json') {
    return new NextResponse(null, { status: 404 })
  }

  // Check security rules
  const rules = await loadSecurityRules()
  const rule = findRule(relPath, rules)
  if (rule && !isWithinDateRange(rule)) return new NextResponse(null, { status: 404 })
  if (rule?.password) {
    const gateUrl = request.nextUrl.clone()
    gateUrl.pathname = `/gate/${encodeURI(relPath)}`
    return NextResponse.redirect(gateUrl)
  }

  const provider = getContentProvider()
  const content = await provider.readFile(relPath)
  if (!content) return new NextResponse(null, { status: 404 })

  const ext = path.extname(relPath).toLowerCase()
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'

  return new NextResponse(content, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
