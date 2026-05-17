import path from 'path'
import { notFound } from 'next/navigation'
import PageWrapper from './PageWrapper'
import { getContentProvider } from '../../lib/content-provider.mjs'
import { loadSecurityRules, findRule, isWithinDateRange, isDownloadAllowed, encryptContent } from '../../lib/security.mjs'

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

  const rules = await loadSecurityRules()
  const rule = findRule(relativeFile, rules)

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
    />
  )
}
