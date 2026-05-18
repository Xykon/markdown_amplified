import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../../lib/admin-auth.mjs'
import { getContentProvider } from '../../../../../lib/content-provider.mjs'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/files/<path>  — delete file
export async function DELETE(request, { params }) {
  if (!await requireAdminAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path: segments } = await params
  const relPath = segments.join('/')

  const provider = getContentProvider()
  try {
    await provider.deleteFile(relPath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
