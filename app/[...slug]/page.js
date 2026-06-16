import path from 'path'
import { notFound } from 'next/navigation'
import PageWrapper from './PageWrapper'
import { getContentProvider } from '../../lib/content-provider.mjs'
import { loadSecurityRules, loadGlobalHome, loadGlobalToc, loadGlobalIndexFile, loadGlobalSiteHeader, loadGlobalDisplayConfig, loadCookieConfig, findRule, findHomeUrl, findGitHubUrl, findTocOpen, findIndexFile, findDisplayConfig, findSiteHeader, isWithinDateRange, isDownloadAllowed, encryptContent } from '../../lib/security.mjs'

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
  // - Otherwise, treat it as a directory and load <dir>/indexFile (e.g., README.md or index.md)
  let relativeFile = requested.endsWith('.md')
    ? requested
    : null  // Will be determined after loading rules and config

  const [rules, globalHome, globalToc, globalIndexFile, cookieConfig, globalSiteHeader, globalDisplayConfig] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadGlobalToc(), loadGlobalIndexFile(), loadCookieConfig(), loadGlobalSiteHeader(), loadGlobalDisplayConfig()])

  if (relativeFile === null) {
    // It's a directory, resolve the index filename
    const indexFileName = findIndexFile(requested, rules, globalIndexFile)
    relativeFile = path.posix.join(requested, indexFileName)
  }

  const rule = findRule(relativeFile, rules)
  const homeUrl = findHomeUrl(relativeFile, rules, globalHome)
  const githubUrl = findGitHubUrl(relativeFile, rules, globalSiteHeader.githubUrl)
  const tocOpen = findTocOpen(relativeFile, rules, globalToc)
  const { name: siteName, banner: siteBanner, bannerLight: siteBannerLight, bannerDark: siteBannerDark, siteButton } = findSiteHeader(relativeFile, rules, globalSiteHeader)
  const displayConfig = findDisplayConfig(relativeFile, rules, globalDisplayConfig)

  if (rule && !isWithinDateRange(rule)) notFound()

  const provider = getContentProvider()
  let fileBuffer = await provider.readFile(relativeFile)

  // Fallback to index.md if configured file doesn't exist
  if (!fileBuffer && !requested.endsWith('.md')) {
    const fallbackFile = path.posix.join(requested, 'index.md')
    if (fallbackFile !== relativeFile) {
      fileBuffer = await provider.readFile(fallbackFile)
    }
  }
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
      resolvedFile={relativeFile}
      content={content}
      encrypted={encrypted ?? undefined}
      validFrom={rule?.validFrom ?? undefined}
      validUntil={rule?.validUntil ?? undefined}
      hasDownload={isDownloadAllowed(rule)}
      homeUrl={homeUrl ?? undefined}
      tocOpen={tocOpen}
      displayConfig={displayConfig}
      cookieConfig={cookieConfig ?? undefined}
      siteName={siteName}
      siteBanner={siteBanner ?? undefined}
      siteBannerLight={siteBannerLight ?? undefined}
      siteBannerDark={siteBannerDark ?? undefined}
      githubUrl={githubUrl}
      siteButton={siteButton ?? undefined}
    />
  )
}
