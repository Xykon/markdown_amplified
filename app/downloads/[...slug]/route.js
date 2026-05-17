import path from 'path'
import { NextResponse } from 'next/server'
import { getContentProvider } from '../../../lib/content-provider.mjs'
import { loadSecurityRules, findRule, isWithinDateRange, isDownloadAllowed } from '../../../lib/security.mjs'

function decodeSlug(slug) {
  return (slug || []).map((s) => {
    try { return decodeURIComponent(s) } catch { return s }
  })
}

export async function GET(request, { params }) {
  const { slug } = await params
  if (!slug || slug.length === 0) return new NextResponse(null, { status: 404 })

  const decodedSlug = decodeSlug(slug)
  const relPath = decodedSlug.join('/')

  if (!relPath.endsWith('.md')) return new NextResponse(null, { status: 404 })

  // Apply the same security rules as the page route
  const rules = loadSecurityRules()
  const rule = findRule(relPath, rules)
  if (!isDownloadAllowed(rule) || (rule && !isWithinDateRange(rule))) {
    return new NextResponse(null, { status: 404 })
  }

  const provider = getContentProvider()
  const content = await provider.readFile(relPath)
  if (!content) return new NextResponse(null, { status: 404 })

  const filename = path.basename(relPath)

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
