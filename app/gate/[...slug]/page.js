import path from 'path'
import { notFound } from 'next/navigation'
import AssetGate from './AssetGate'
import { loadSecurityRules, loadGlobalHome, loadGlobalSiteHeader, loadCookieConfig, findRule, findHomeUrl, findSiteHeader, isWithinDateRange, encryptContent } from '../../../lib/security.mjs'

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

  const [rules, globalHome, cookieConfig, globalSiteHeader] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadCookieConfig(), loadGlobalSiteHeader()])
  const rule = findRule(relPath, rules)

  // Gate only exists for password-protected files
  if (!rule?.password) notFound()

  const withinDateRange = isWithinDateRange(rule)
  const filename = path.posix.basename(relPath)
  const homeUrl = findHomeUrl(relPath, rules, globalHome)
  const { name: siteName, banner: siteBanner, bannerLight: siteBannerLight, bannerDark: siteBannerDark, siteButton } = findSiteHeader(relPath, rules, globalSiteHeader)

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
      siteName={siteName}
      siteBanner={siteBanner ?? undefined}
      siteBannerLight={siteBannerLight ?? undefined}
      siteBannerDark={siteBannerDark ?? undefined}
      siteButton={siteButton ?? undefined}
    />
  )
}
