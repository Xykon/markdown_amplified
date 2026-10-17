import { getContentProvider } from '../lib/content-provider.mjs'
import { relativePathToUrlPath } from '../lib/markdown-meta.mjs'
import { loadGlobalSeo, loadSecurityRules, findRule, isWithinDateRange } from '../lib/security.mjs'

// Built per request, like /llms.txt. Next prerenders a sitemap at build time unless told otherwise,
// which froze it to the build's content and siteUrl: a container serving mounted content, or a site
// whose content and config live in S3, kept the list the build saw. The config underneath is still
// cached for up to a minute (lib/security.mjs).
export const dynamic = 'force-dynamic'

export default async function sitemap() {
  const [seo, rules] = await Promise.all([loadGlobalSeo(), loadSecurityRules()])
  if (!seo.siteUrl) return []

  const provider = getContentProvider()
  const files = await provider.listMarkdownFiles()
  const site = seo.siteUrl.replace(/\/$/, '')

  const entries = files
    .filter((filePath) => {
      const rule = findRule(filePath, rules)
      if (!rule) return true
      if (rule.password) return false
      if ((rule.validFrom || rule.validUntil) && !isWithinDateRange(rule)) return false
      return true
    })
    .map((filePath) => ({
      url: `${site}${relativePathToUrlPath(filePath)}`,
      changeFrequency: 'weekly',
      priority: filePath === 'index.md' ? 1 : 0.7,
    }))

  const uniqueByUrl = new Map()
  for (const entry of entries) {
    if (!uniqueByUrl.has(entry.url)) uniqueByUrl.set(entry.url, entry)
  }

  return Array.from(uniqueByUrl.values())
}
