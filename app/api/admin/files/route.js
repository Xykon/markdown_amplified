import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../lib/admin-auth.mjs'
import { getContentProvider } from '../../../../lib/content-provider.mjs'

export const dynamic = 'force-dynamic'

// GET /api/admin/files?path=<dir>  — list directory
export async function GET(request) {
  if (!await requireAdminAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get('path') || ''

  const provider = getContentProvider()
  try {
    const listing = await provider.listDirectory(relPath)
    return NextResponse.json(listing)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/admin/files?path=<file>  — upload file (body is raw bytes)
export async function POST(request) {
  if (!await requireAdminAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get('path') || ''
  if (!relPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const provider = getContentProvider()
  try {
    const buf = Buffer.from(await request.arrayBuffer())
    await provider.writeFile(relPath, buf)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
