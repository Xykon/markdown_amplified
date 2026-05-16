import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'
import PageWrapper from './PageWrapper'
import { getActiveContentDir, getActiveMarkdownFiles } from '../../content-source.mjs'
import { loadSecurityRules, findRule, isWithinDateRange, encryptContent } from '../../lib/security.mjs'

// Only pre-generated paths are valid; all others return 404
export const dynamicParams = false

export async function generateStaticParams() {
  const files = getActiveMarkdownFiles()
  const rules = loadSecurityRules()
  const params = []

  for (const file of files) {
    const rule = findRule(file, rules)
    if (rule && !isWithinDateRange(rule)) continue

    const segments = file.split('/')
    params.push({ slug: segments })

    // For <dir>/index.md, also emit a directory-style slug so
    // `/<dir>` automatically renders the directory's index.md
    if (segments.length > 1 && segments[segments.length - 1] === 'index.md') {
      params.push({ slug: segments.slice(0, -1) })
    }
  }

  return params
}

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

  const activeContentDir = getActiveContentDir()
  const contentRoot = path.resolve(activeContentDir)

  // Resolve the slug to a markdown file:
  // - If it ends in .md, use it directly
  // - Otherwise, treat it as a directory and load <dir>/index.md
  const relativeFile = requested.endsWith('.md')
    ? requested
    : path.posix.join(requested, 'index.md')

  const filePath = path.resolve(activeContentDir, relativeFile)

  // Sanitize: prevent directory traversal
  if (filePath !== contentRoot && !filePath.startsWith(contentRoot + path.sep)) {
    notFound()
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    notFound()
  }

  const rules = loadSecurityRules()
  const rule = findRule(relativeFile, rules)

  if (rule && !isWithinDateRange(rule)) notFound()

  const rawContent = fs.readFileSync(filePath, 'utf-8')

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
    />
  )
}
