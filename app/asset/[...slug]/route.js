import path from 'path'
import { NextResponse } from 'next/server'
import { getContentProvider } from '../../../lib/content-provider.mjs'

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
}

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
