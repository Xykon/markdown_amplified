import matter from 'gray-matter'

function cleanString(value) {
  if (typeof value !== 'string') return null
  const out = value.trim()
  return out ? out : null
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

function firstHeading(markdown) {
  const m = markdown.match(/^#[ \t]+(.+)$/m)
  if (!m) return null
  return m[1].trim().replace(/[`*_~\[\]()]/g, '').trim() || null
}

function firstParagraph(markdown) {
  const lines = markdown.split(/\r?\n/)
  let block = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      if (block.length > 0) break
      continue
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      if (block.length > 0) break
      continue
    }

    if (/^([-*_]\s?){3,}$/.test(trimmed)) {
      continue
    }

    if (/^```/.test(trimmed) || /^>/.test(trimmed) || /^\|/.test(trimmed)) {
      if (block.length > 0) break
      continue
    }

    block.push(trimmed)
  }

  if (!block.length) return null

  const plain = block
    .join(' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plain || null
}

export function parseMarkdownDocument(rawContent) {
  const parsed = matter(rawContent || '')
  const content = parsed.content || ''
  const data = parsed.data || {}

  const title = cleanString(data.title) || firstHeading(content)
  const description = cleanString(data.description) || firstParagraph(content)

  return {
    content,
    metadata: {
      title,
      description,
      canonical: cleanString(data.canonical),
      robots: cleanString(data.robots),
      ogImage: cleanString(data.ogImage || data.og_image),
      schemaType: cleanString(data.schemaType || data.schema_type),
      keywords: normalizeKeywords(data.keywords),
      llmSummary: cleanString(data.llmSummary || data.llm_summary),
      schema: (data.schema && typeof data.schema === 'object') ? data.schema : null,
    },
  }
}

export function toRobotsValue(value) {
  if (!value) return null
  const normalized = value.toLowerCase().replace(/\s+/g, '')
  if (!normalized) return null

  const directives = new Set(normalized.split(',').filter(Boolean))
  const index = directives.has('noindex') ? false : true
  const follow = directives.has('nofollow') ? false : true

  return { index, follow }
}

export function relativePathToUrlPath(relativeFile) {
  if (!relativeFile || relativeFile === 'index.md') return '/'
  if (relativeFile.endsWith('/index.md')) {
    return `/${relativeFile.slice(0, -'index.md'.length)}`
  }
  return `/${relativeFile}`
}

export function joinAbsoluteUrl(siteUrl, pathOrUrl) {
  if (!pathOrUrl) return null
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  if (!siteUrl) return null
  try {
    return new URL(pathOrUrl, siteUrl).toString()
  } catch {
    return null
  }
}
