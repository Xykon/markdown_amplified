import path from 'path'
import { notFound } from 'next/navigation'
import PageWrapper from './PageWrapper'
import { getContentProvider } from '../../lib/content-provider.mjs'
import { parseMarkdownDocument, toRobotsValue, relativePathToUrlPath, joinAbsoluteUrl } from '../../lib/markdown-meta.mjs'
import { loadSecurityRules, loadGlobalHome, loadGlobalToc, loadGlobalIndexFile, loadGlobalSiteHeader, loadGlobalDisplayConfig, loadCookieConfig, loadGlobalSeo, findRule, findHomeUrl, findGitHubUrl, findTocOpen, findIndexFile, findDisplayConfig, findSiteHeader, isWithinDateRange, isDownloadAllowed, encryptContent } from '../../lib/security.mjs'

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
  const decodedSlug = decodeSlug(slug)
  const requested = decodedSlug.join('/')
  const fallbackTitle = path.posix.basename(requested || 'document', '.md') || 'Document'

  const [rules, globalIndexFile, globalSeo] = await Promise.all([
    loadSecurityRules(),
    loadGlobalIndexFile(),
    loadGlobalSeo(),
  ])

  let relativeFile = requested.endsWith('.md')
    ? requested
    : path.posix.join(requested, findIndexFile(requested, rules, globalIndexFile))

  const rule = findRule(relativeFile, rules)
  if (rule && !isWithinDateRange(rule)) {
    return { robots: { index: false, follow: false } }
  }
  if (rule?.password) {
    return {
      title: fallbackTitle,
      robots: { index: false, follow: false },
    }
  }

  const provider = getContentProvider()
  let fileBuffer = await provider.readFile(relativeFile)
  if (!fileBuffer && !requested.endsWith('.md')) {
    const fallbackFile = path.posix.join(requested, 'index.md')
    if (fallbackFile !== relativeFile) {
      fileBuffer = await provider.readFile(fallbackFile)
      if (fileBuffer) relativeFile = fallbackFile
    }
  }

  if (!fileBuffer) {
    return { robots: { index: false, follow: false } }
  }

  const parsed = parseMarkdownDocument(fileBuffer.toString('utf-8'))
  const defaultTitle = path.posix.basename(relativeFile, '.md') || requested || fallbackTitle
  const title = parsed.metadata.title || defaultTitle
  const canonicalPath = relativePathToUrlPath(relativeFile)
  const canonicalUrl = parsed.metadata.canonical
    ? joinAbsoluteUrl(globalSeo.siteUrl, parsed.metadata.canonical)
    : joinAbsoluteUrl(globalSeo.siteUrl, canonicalPath)
  const ogImage = joinAbsoluteUrl(globalSeo.siteUrl, parsed.metadata.ogImage)

  return {
    title,
    description: parsed.metadata.description || globalSeo.defaultDescription || undefined,
    keywords: parsed.metadata.keywords.length ? parsed.metadata.keywords : undefined,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    robots: toRobotsValue(parsed.metadata.robots) || undefined,
    openGraph: {
      type: 'article',
      title,
      description: parsed.metadata.description || globalSeo.defaultDescription || undefined,
      url: canonicalUrl || undefined,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description: parsed.metadata.description || globalSeo.defaultDescription || undefined,
      images: ogImage ? [ogImage] : undefined,
    },
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

  const [rules, globalHome, globalToc, globalIndexFile, cookieConfig, globalSiteHeader, globalDisplayConfig, globalSeo] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadGlobalToc(), loadGlobalIndexFile(), loadCookieConfig(), loadGlobalSiteHeader(), loadGlobalDisplayConfig(), loadGlobalSeo()])

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
  const parsed = parseMarkdownDocument(rawContent)

  let content = parsed.content
  let encrypted = null

  if (rule?.password) {
    encrypted = await encryptContent(parsed.content, rule.password)
    content = null
  }

  let schema = null
  if (!rule?.password) {
    if (parsed.metadata.schema && typeof parsed.metadata.schema === 'object') {
      schema = parsed.metadata.schema
    } else {
      const url = joinAbsoluteUrl(globalSeo.siteUrl, relativePathToUrlPath(relativeFile))
      const schemaType = parsed.metadata.schemaType || 'TechArticle'
      schema = {
        '@context': 'https://schema.org',
        '@type': schemaType,
        headline: parsed.metadata.title || path.posix.basename(relativeFile, '.md'),
        description: parsed.metadata.description || undefined,
        url: url || undefined,
        keywords: parsed.metadata.keywords.length ? parsed.metadata.keywords.join(', ') : undefined,
      }
    }
  }

  return <>
    {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />}
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
  </>
}
