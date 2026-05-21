import path from 'path'
import { notFound } from 'next/navigation'
import PageWrapper from './PageWrapper'
import { getContentProvider } from '../../lib/content-provider.mjs'
import { loadSecurityRules, loadGlobalHome, loadGlobalToc, loadGlobalSiteHeader, loadCookieConfig, findRule, findHomeUrl, findTocOpen, findSiteHeader, isWithinDateRange, isDownloadAllowed, encryptContent } from '../../lib/security.mjs'

function decodeSlug(slug) {
  return (slug || []).map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const filename = decodeSlug(slug).join('/')
  return {
    title: filename || 'Not Found',
  }
}

export default async function MarkdownPage({ params }) {
  const { slug } = await params
  if (!slug || slug.length === 0) {
    notFound()
  }

  const decodedSlug = decodeSlug(slug)
  const requested = decodedSlug.join('/')

  // Resolve the slug to a markdown file:
  // - If it ends in .md, use it directly
  // - Otherwise, treat it as a directory and load <dir>/index.md
  const relativeFile = requested.endsWith('.md')
    ? requested
    : path.posix.join(requested, 'index.md')

  const [rules, globalHome, globalToc, cookieConfig, globalSiteHeader] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadGlobalToc(), loadCookieConfig(), loadGlobalSiteHeader()])
  const rule = findRule(relativeFile, rules)
  const homeUrl = findHomeUrl(relativeFile, rules, globalHome)
  const tocOpen = findTocOpen(relativeFile, rules, globalToc)
  const { name: siteName, banner: siteBanner, bannerLight: siteBannerLight, bannerDark: siteBannerDark, siteButton } = findSiteHeader(relativeFile, rules, globalSiteHeader)

  if (rule && !isWithinDateRange(rule)) notFound()

  const provider = getContentProvider()
  const fileBuffer = await provider.readFile(relativeFile)
  if (!fileBuffer) notFound()

  const rawContent = fileBuffer.toString('utf-8')

  let content = rawContent
  let encrypted = null

  if (rule?.password) {
    encrypted = await encryptContent(rawContent, rule.password)
    content = null
  }

  return (
    <PageWrapper
      slug={decodedSlug}
      content={content}
      encrypted={encrypted ?? undefined}
      validFrom={rule?.validFrom ?? undefined}
      validUntil={rule?.validUntil ?? undefined}
      hasDownload={isDownloadAllowed(rule)}
      homeUrl={homeUrl ?? undefined}
      tocOpen={tocOpen}
      cookieConfig={cookieConfig ?? undefined}
      siteName={siteName}
      siteBanner={siteBanner ?? undefined}
      siteBannerLight={siteBannerLight ?? undefined}
      siteBannerDark={siteBannerDark ?? undefined}
      siteButton={siteButton ?? undefined}
    />
  )
}
