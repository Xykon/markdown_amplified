import { getContentProvider } from '../lib/content-provider.mjs'
import { parseMarkdownDocument, toRobotsValue, joinAbsoluteUrl } from '../lib/markdown-meta.mjs'
import { loadSecurityRules, loadGlobalHome, loadGlobalToc, loadGlobalIndexFile, loadGlobalSiteHeader, loadGlobalDisplayConfig, loadGlobalSeo, findSiteHeader, findRule, findHomeUrl, findGitHubUrl, findTocOpen, findIndexFile, findDisplayConfig, isWithinDateRange, isDownloadAllowed, encryptContent } from '../lib/security.mjs'
import SecurityGate from './SecurityGate'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const [rules, globalIndexFile, seo] = await Promise.all([
    loadSecurityRules(),
    loadGlobalIndexFile(),
    loadGlobalSeo(),
  ])

  const provider = getContentProvider()
  const indexFileName = findIndexFile('', rules, globalIndexFile)
  const rule = findRule(indexFileName, rules)
  if (rule?.password) {
    return {
      robots: { index: false, follow: false },
    }
  }

  let fileBuffer = await provider.readFile(indexFileName)
  if (!fileBuffer && indexFileName !== 'index.md') {
    fileBuffer = await provider.readFile('index.md')
  }

  if (!fileBuffer) {
    return {
      robots: { index: false, follow: false },
    }
  }

  const parsed = parseMarkdownDocument(fileBuffer.toString('utf-8'))
  const title = parsed.metadata.title || 'Home'
  const canonicalUrl = joinAbsoluteUrl(seo.siteUrl, parsed.metadata.canonical || '/')
  const ogImage = joinAbsoluteUrl(seo.siteUrl, parsed.metadata.ogImage)

  return {
    title,
    description: parsed.metadata.description || seo.defaultDescription || undefined,
    keywords: parsed.metadata.keywords.length ? parsed.metadata.keywords : undefined,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    robots: toRobotsValue(parsed.metadata.robots) || undefined,
    openGraph: {
      type: 'website',
      title,
      description: parsed.metadata.description || seo.defaultDescription || undefined,
      url: canonicalUrl || undefined,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description: parsed.metadata.description || seo.defaultDescription || undefined,
      images: ogImage ? [ogImage] : undefined,
    },
  }
}

export default async function Home() {
  const [rules, globalHome, globalToc, globalIndexFile, globalSiteHeader, globalDisplayConfig, seo] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadGlobalToc(), loadGlobalIndexFile(), loadGlobalSiteHeader(), loadGlobalDisplayConfig(), loadGlobalSeo()])
  const indexFileName = findIndexFile('', rules, globalIndexFile)
  const rule = findRule(indexFileName, rules)
  const homeUrl = findHomeUrl(indexFileName, rules, globalHome)
  const githubUrl = findGitHubUrl(indexFileName, rules, globalSiteHeader.githubUrl)
  const tocOpen = findTocOpen(indexFileName, rules, globalToc)
  const { name: siteName, banner: siteBanner, bannerLight: siteBannerLight, bannerDark: siteBannerDark, siteButton } = findSiteHeader(indexFileName, rules, globalSiteHeader)
  const displayConfig = findDisplayConfig(indexFileName, rules, globalDisplayConfig)

  if (rule && !isWithinDateRange(rule)) return null

  const provider = getContentProvider()
  let fileBuffer = await provider.readFile(indexFileName)
  let resolvedFile = indexFileName
  if (!fileBuffer) {
    // Fallback to index.md if configured file doesn't exist
    if (indexFileName !== 'index.md') {
      fileBuffer = await provider.readFile('index.md')
      if (fileBuffer) resolvedFile = 'index.md'
    }
  }
  if (!fileBuffer) return null

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
      const schemaType = parsed.metadata.schemaType || 'WebSite'
      schema = {
        '@context': 'https://schema.org',
        '@type': schemaType,
        name: parsed.metadata.title || siteName,
        description: parsed.metadata.description || seo.defaultDescription || undefined,
        url: joinAbsoluteUrl(seo.siteUrl, '/') || undefined,
        keywords: parsed.metadata.keywords.length ? parsed.metadata.keywords.join(', ') : undefined,
      }
    }
  }

  return <>
    {schema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />}
    <SecurityGate
      slug={['index.md']}
      resolvedFile={resolvedFile}
      content={content}
      encrypted={encrypted ?? undefined}
      validFrom={rule?.validFrom ?? undefined}
      validUntil={rule?.validUntil ?? undefined}
      hasDownload={isDownloadAllowed(rule)}
      homeUrl={homeUrl ?? undefined}
      tocOpen={tocOpen}
      displayConfig={displayConfig}
      siteName={siteName}
      siteBanner={siteBanner}
      siteBannerLight={siteBannerLight ?? undefined}
      siteBannerDark={siteBannerDark ?? undefined}
      githubUrl={githubUrl}
      siteButton={siteButton ?? undefined}
    />
  </>
}
