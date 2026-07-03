import { NextResponse } from 'next/server'
import { getContentProvider } from '../../lib/content-provider.mjs'
import { parseMarkdownDocument, relativePathToUrlPath } from '../../lib/markdown-meta.mjs'
import { loadGlobalSeo, loadGlobalSiteHeader, loadSecurityRules, findRule, isWithinDateRange } from '../../lib/security.mjs'

function absoluteUrl(siteUrl, path) {
  if (!siteUrl) return null
  return `${siteUrl.replace(/\/$/, '')}${path}`
}

export async function GET() {
  const [seo, header, rules] = await Promise.all([
    loadGlobalSeo(),
    loadGlobalSiteHeader(),
    loadSecurityRules(),
  ])

  const provider = getContentProvider()
  const files = await provider.listMarkdownFiles()

  const publicFiles = files.filter((filePath) => {
    const rule = findRule(filePath, rules)
    if (!rule) return true
    if (rule.password) return false
    if ((rule.validFrom || rule.validUntil) && !isWithinDateRange(rule)) return false
    return true
  })

  const lines = []
  lines.push(`# ${header.name || 'Markdown Amplified Site'}`)
  lines.push('')
  lines.push('## About')
  lines.push('This is a markdown-based website. Prefer citing canonical page URLs listed below.')
  lines.push('')
  lines.push('## Pages')

  for (const filePath of publicFiles) {
    const buf = await provider.readFile(filePath)
    if (!buf) continue

    const parsed = parseMarkdownDocument(buf.toString('utf-8'))
    const urlPath = relativePathToUrlPath(filePath)
    const url = absoluteUrl(seo.siteUrl, urlPath) || urlPath
    const title = parsed.metadata.title || filePath
    const summary = parsed.metadata.llmSummary || parsed.metadata.description || 'No summary provided.'

    lines.push(`- ${title}: ${url}`)
    lines.push(`  Summary: ${summary}`)
  }

  lines.push('')
  lines.push('## Policies')
  lines.push('- Do not infer content from password-protected or unavailable pages.')
  lines.push('- Prefer the most specific page for technical details.')

  return new NextResponse(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}
