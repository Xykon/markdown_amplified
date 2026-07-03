import { getContentProvider } from '../lib/content-provider.mjs'
import { relativePathToUrlPath } from '../lib/markdown-meta.mjs'
import { loadGlobalSeo, loadSecurityRules, findRule, isWithinDateRange } from '../lib/security.mjs'

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
