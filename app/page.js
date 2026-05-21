import { getContentProvider } from '../lib/content-provider.mjs'
import { loadSecurityRules, loadGlobalHome, loadGlobalToc, loadGlobalSiteHeader, findRule, findHomeUrl, findTocOpen, findSiteHeader, isWithinDateRange, isDownloadAllowed, encryptContent } from '../lib/security.mjs'
import SecurityGate from './SecurityGate'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const [rules, globalHome, globalToc, globalSiteHeader] = await Promise.all([loadSecurityRules(), loadGlobalHome(), loadGlobalToc(), loadGlobalSiteHeader()])
  const rule = findRule('index.md', rules)
  const siteName = findSiteHeader('index.md', rules, globalSiteHeader).name ?? 'Markdown Amplified'
  const homeUrl = findHomeUrl('index.md', rules, globalHome)
  const tocOpen = findTocOpen('index.md', rules, globalToc)

  if (rule && !isWithinDateRange(rule)) return null

  const provider = getContentProvider()
  const fileBuffer = await provider.readFile('index.md')
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
      content={content}
      encrypted={encrypted ?? undefined}
      validFrom={rule?.validFrom ?? undefined}
      validUntil={rule?.validUntil ?? undefined}
      hasDownload={isDownloadAllowed(rule)}
      homeUrl={homeUrl ?? undefined}
      tocOpen={tocOpen}
      siteName={siteName}
    />
  )
}
