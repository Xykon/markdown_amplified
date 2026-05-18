import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../../lib/admin-auth.mjs'
import { getContentProvider } from '../../../../../lib/content-provider.mjs'

export const dynamic = 'force-dynamic'

// DELETE /api/admin/files/<path>           — delete file
// DELETE /api/admin/files/<path>?type=dir  — delete directory (empty only)
// DELETE /api/admin/files/<path>?type=dir&recursive=1 — recursive delete
export async function DELETE(request, { params }) {
  const adminConfig = await requireAdminAuth(request)
  if (!adminConfig) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (adminConfig.readonly === true) return NextResponse.json({ error: 'Read-only mode' }, { status: 403 })

  const { path: segments } = await params
  const relPath = segments.join('/')
  if (!relPath) return NextResponse.json({ error: 'invalid_path' }, { status: 400 })

  // Refuse to delete the security configuration. Removing it disables admin
  // auth, password protection, and all access rules — it would silently
  // brick security and lock the admin user out of the UI.
  if (relPath === 'content-security.json') {
    return NextResponse.json({ error: 'protected_file' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const isDir = searchParams.get('type') === 'dir'
  const recursive = searchParams.get('recursive') === '1'

  const provider = getContentProvider()
  try {
    if (isDir) {
      const result = await provider.deleteDirectory(relPath, { recursive })
      return NextResponse.json({ ok: true, ...result })
    }
    await provider.deleteFile(relPath)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err && err.code === 'not_empty')
      return NextResponse.json({ error: 'not_empty', count: err.count, size: err.size }, { status: 409 })
    if (err && err.code === 'too_large')
      return NextResponse.json({ error: 'too_large', count: err.count, size: err.size }, { status: 413 })
    if (err && err.code === 'invalid_path')
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 })
    console.error('admin delete error:', err)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
}
