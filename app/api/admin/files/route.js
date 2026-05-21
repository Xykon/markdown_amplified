import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../lib/admin-auth.mjs'
import { getContentProvider } from '../../../../lib/content-provider.mjs'
import { loadSecurityRules, findRule, isWithinDateRange, isDownloadAllowed, loadRootSecurity } from '../../../../lib/security.mjs'

export const dynamic = 'force-dynamic'

// Hard cap on uploaded file size. The admin UI is not a backup tool.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

// Extensions that the browser will execute as active content when served
// directly from /asset/. Blocking them at upload time prevents stored XSS
// from an attacker who somehow obtains admin credentials, and stops admins
// from accidentally publishing dangerous files. This is intentionally a
// blocklist (not an allowlist) so legitimate documentation assets keep
// working — extend the list as new active-content types appear.
const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.xml', '.xsl',
])

// Compute security flags for a single path against the loaded rules.
// Returns null when no rule matches and no flags apply.
function computeSecFlags(relPath, rules) {
  const rule = findRule(relPath, rules)
  if (!rule) return null
  const out = {}
  if (rule.password) out.password = true
  if (rule.validFrom || rule.validUntil) {
    out.dateGated = true
    out.dateActive = isWithinDateRange(rule)
  }
  if (rule.download !== undefined) {
    out.downloadExplicit = true
    out.downloadAllowed = isDownloadAllowed(rule)
  }
  if (rule.toc !== undefined) out.toc = rule.toc
  if (rule.name !== undefined) out.hasName = true
  if (rule.home !== undefined) out.hasHome = true
  if (rule.banner !== undefined || rule.bannerLight !== undefined ||
      rule.bannerDark !== undefined || rule.homeIcon !== undefined) out.hasBanner = true
  return Object.keys(out).length ? out : null
}

// GET /api/admin/files?path=<dir>  — list directory with security annotations
export async function GET(request) {
  if (!await requireAdminAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get('path') || ''

  const provider = getContentProvider()
  try {
    const [listing, rules, rootFlags] = await Promise.all([
      provider.listDirectory(relPath),
      loadSecurityRules(),
      !relPath ? loadRootSecurity() : Promise.resolve(null),
    ])

    const dirs = listing.dirs.map(d => {
      const dPath = relPath ? `${relPath}/${d.name}/` : `${d.name}/`
      const sec = computeSecFlags(dPath, rules)
      return sec ? { ...d, security: sec } : d
    })

    const files = listing.files.map(f => {
      const fPath = relPath ? `${relPath}/${f.name}` : f.name
      const sec = computeSecFlags(fPath, rules)
      return sec ? { ...f, security: sec } : f
    })

    // Security for the current directory itself (shown as the root/folder row in the UI)
    let currentSecurity = null
    if (relPath) {
      currentSecurity = computeSecFlags(relPath + '/', rules)
    } else if (rootFlags && Object.keys(rootFlags).length) {
      currentSecurity = rootFlags
    }

    return NextResponse.json({ dirs, files, currentSecurity })
  } catch (err) {
    console.error('admin list error:', err)
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }
}

// POST /api/admin/files?path=<file>  — upload file (body is raw bytes)
export async function POST(request) {
  const adminConfig = await requireAdminAuth(request)
  if (!adminConfig) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (adminConfig.readonly === true) return NextResponse.json({ error: 'Read-only mode' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const relPath = searchParams.get('path') || ''
  if (!relPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  // Extension check (case-insensitive). Pull the segment after the last dot
  // in the final path component.
  const base = relPath.split('/').pop() || ''
  const dotIdx = base.lastIndexOf('.')
  const ext = dotIdx >= 0 ? base.slice(dotIdx).toLowerCase() : ''
  if (BLOCKED_UPLOAD_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'blocked_extension', extension: ext }, { status: 415 })
  }

  // Pre-check Content-Length when the client supplies it, so we can reject
  // oversized uploads before buffering the whole body.
  const declaredLength = parseInt(request.headers.get('content-length') || '0', 10)
  if (declaredLength && declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'too_large', limit: MAX_UPLOAD_BYTES }, { status: 413 })
  }

  const provider = getContentProvider()
  try {
    const buf = Buffer.from(await request.arrayBuffer())
    if (buf.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'too_large', limit: MAX_UPLOAD_BYTES }, { status: 413 })
    }
    await provider.writeFile(relPath, buf)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('admin upload error:', err)
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 })
  }
}
