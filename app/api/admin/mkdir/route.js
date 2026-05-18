import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../lib/admin-auth.mjs'
import { getContentProvider } from '../../../../lib/content-provider.mjs'

export const dynamic = 'force-dynamic'

// POST /api/admin/mkdir  — create directory
export async function POST(request) {
  if (!await requireAdminAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const relPath = body.path || ''
  if (!relPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const provider = getContentProvider()
  try {
    await provider.createDirectory(relPath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
