import { getContentProvider } from '../lib/content-provider.mjs'
import { loadSecurityRules, loadGlobalHome, loadGlobalToc, loadGlobalIndexFile, loadGlobalSiteHeader, findSiteHeader, findRule, findHomeUrl, findTocOpen, findIndexFile, isWithinDateRange, isDownloadAllowed, encryptContent } from '../lib/security.mjs'
import SecurityGate from './SecurityGate'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const [rules, globalHome, globalToc, globalIndexFile, globalSiteHeader] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadGlobalToc(), loadGlobalIndexFile(), loadGlobalSiteHeader()])
  const indexFileName = findIndexFile('', rules, globalIndexFile)
  const rule = findRule(indexFileName, rules)
  const homeUrl = findHomeUrl(indexFileName, rules, globalHome)
  const tocOpen = findTocOpen(indexFileName, rules, globalToc)
  const { name: siteName, banner: siteBanner, bannerLight: siteBannerLight, bannerDark: siteBannerDark, siteButton } = findSiteHeader(indexFileName, rules, globalSiteHeader)

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

  let content = rawContent
  let encrypted = null

  if (rule?.password) {
    encrypted = await encryptContent(rawContent, rule.password)
    content = null
  }

  return (
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
      siteName={siteName}
      siteBanner={siteBanner}
      siteBannerLight={siteBannerLight ?? undefined}
      siteBannerDark={siteBannerDark ?? undefined}
      siteButton={siteButton ?? undefined}
    />
  )
}
