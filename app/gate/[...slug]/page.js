import path from 'path'
import { notFound } from 'next/navigation'
import AssetGate from './AssetGate'
import { loadSecurityRules, loadGlobalHome, loadCookieConfig, findRule, findHomeUrl, isWithinDateRange, encryptContent } from '../../../lib/security.mjs'

function decodeSlug(slug) {
  return (slug || []).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const filename = path.posix.basename(decodeSlug(slug).join('/'))
  return { title: filename || 'Download' }
}

export default async function GatePage({ params }) {
  const { slug } = await params
  if (!slug || slug.length === 0) notFound()

  const decodedSlug = decodeSlug(slug)
  const relPath = decodedSlug.join('/')

  if (relPath.endsWith('.md') || relPath === 'content-security.json') notFound()

  const [rules, globalHome, cookieConfig] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadCookieConfig()])
  const rule = findRule(relPath, rules)

  // Gate only exists for password-protected files
  if (!rule?.password) notFound()

  const withinDateRange = isWithinDateRange(rule)
  const filename = path.posix.basename(relPath)
  const homeUrl = findHomeUrl(relPath, rules, globalHome)

  const encrypted = withinDateRange ? await encryptContent(relPath, rule.password) : null

  return (
    <AssetGate
      relPath={relPath}
      filename={filename}
      encrypted={encrypted ?? undefined}
      validFrom={rule.validFrom ?? undefined}
      validUntil={rule.validUntil ?? undefined}
      homeUrl={homeUrl ?? undefined}
      cookieConfig={cookieConfig ?? undefined}
    />
  )
}
