import { getContentProvider } from '../lib/content-provider.mjs'
import { loadSecurityRules, loadGlobalHome, findRule, findHomeUrl, isWithinDateRange, isDownloadAllowed, encryptContent } from '../lib/security.mjs'
import SecurityGate from './SecurityGate'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const [rules, globalHome] = await Promise.all([loadSecurityRules(), loadGlobalHome()])
  const rule = findRule('index.md', rules)
  const homeUrl = findHomeUrl('index.md', rules, globalHome)

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
    />
  )
}
