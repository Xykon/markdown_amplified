import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../lib/admin-auth.mjs'
import { invalidateConfigCache } from '../../../../lib/security.mjs'

export const dynamic = 'force-dynamic'

// Same priority as loadConfig: root file first, then content provider.
async function readSecurityFile() {
  const rootPath = path.join(process.cwd(), 'content-security.json')
  if (fs.existsSync(rootPath)) {
    try { return JSON.parse(fs.readFileSync(rootPath, 'utf-8')) } catch { return {} }
  }
  try {
    const { getContentProvider } = await import('../../../../lib/content-provider.mjs')
    const buf = await getContentProvider().readFile('content-security.json')
    return buf ? JSON.parse(buf.toString('utf-8')) : {}
  } catch { return {} }
}

async function writeSecurityFile(json) {
  const rootPath = path.join(process.cwd(), 'content-security.json')
  if (fs.existsSync(rootPath)) {
    fs.writeFileSync(rootPath, json, 'utf-8')
    return
  }
  const { getContentProvider } = await import('../../../../lib/content-provider.mjs')
  await getContentProvider().writeFile('content-security.json', Buffer.from(json, 'utf-8'))
}

// GET /api/admin/security — returns full config object
export async function GET(request) {
  const adminConfig = await requireAdminAuth(request)
  if (!adminConfig) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await readSecurityFile())
}

// PUT /api/admin/security — replaces full config, invalidates cache
export async function PUT(request) {
  const adminConfig = await requireAdminAuth(request)
  if (!adminConfig) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (adminConfig.readonly === true) return NextResponse.json({ error: 'Read-only mode' }, { status: 403 })

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || Array.isArray(body) || body === null) {
    return NextResponse.json({ error: 'Config must be an object' }, { status: 400 })
  }
  // Guard against accidental lock-out
  if (!body.admin || typeof body.admin.password !== 'string' || !body.admin.password) {
    return NextResponse.json({ error: 'admin.password is required' }, { status: 400 })
  }

  await writeSecurityFile(JSON.stringify(body, null, 2))
  invalidateConfigCache()
  return NextResponse.json({ ok: true })
}
