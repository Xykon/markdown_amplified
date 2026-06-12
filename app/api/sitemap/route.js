import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getContentProvider } from '../../../lib/content-provider.mjs'
import {
  loadSecurityRules,
  loadCookieConfig,
  loadGlobalIndexFile,
  findRule,
  isWithinDateRange,
} from '../../../lib/security.mjs'

const MAX_DEPTH = 5
const MAX_NODES = 200

function filenameFallback(filePath) {
  return filePath.split('/').pop().replace(/\.md$/i, '')
}

function extractTitle(content, fallback) {
  const m = content.match(/^#[ \t]+(.+)$/m)
  if (!m) return fallback
  // Strip common inline markdown markers
  return m[1].trim().replace(/[`*_~[\]()]/g, '').trim() || fallback
}

// Resolve a relative href from a file to an absolute content path
function resolvePath(fromFile, href) {
  const baseDir = fromFile.includes('/')
    ? fromFile.split('/').slice(0, -1).join('/')
    : ''
  const combined = baseDir ? `${baseDir}/${href}` : href
  const out = []
  for (const p of combined.split('/')) {
    if (p === '.' || p === '') continue
    if (p === '..') { if (out.length) out.pop() }
    else out.push(p)
  }
  return out.join('/')
}

// Extract internal markdown and directory links from content
function extractMarkdownLinks(content, fromFile) {
  const links = []
  const seen = new Set()
  // [text](url) but not images ![]()
  const RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g
  for (const [, rawHref] of content.matchAll(RE)) {
    const href = rawHref.split(/[#?]/)[0].trim()
    if (!href) continue
    if (/^[a-z+]+:/i.test(href)) continue  // external URL
    if (href.startsWith('/')) continue       // absolute internal (skip for now)
    const isDir = href.endsWith('/')
    const isMarkdown = !isDir && href.endsWith('.md')
    if (!isMarkdown && !isDir) continue
    const pathPart = isDir ? href.slice(0, -1) : href
    const resolved = resolvePath(fromFile, pathPart)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    links.push({ resolved, isDir })
  }
  return links
}

export async function GET() {
  try {
    const provider = getContentProvider()
    const [rules, cookieConfig, globalIndexFile] = await Promise.all([
      loadSecurityRules(),
      loadCookieConfig(),
      loadGlobalIndexFile(),
    ])
    const indexFile = globalIndexFile || 'index.md'

    // Collect the user's persisted unlock passwords from cookies.
    // Cookie values ARE the plaintext passwords the user entered.
    // This only works when cookie-based password persistence is enabled.
    const unlockPasswords = new Set()
    if (cookieConfig) {
      const jar = await cookies()
      const needle = `${cookieConfig.prefix}-unlock-`
      for (const { name, value } of jar.getAll()) {
        if (name.startsWith(needle) && value) unlockPasswords.add(value)
      }
    }

    function accessible(filePath) {
      const rule = findRule(filePath, rules)
      if (!rule) return true
      // Hide date-gated content outside its active window
      if ((rule.validFrom || rule.validUntil) && !isWithinDateRange(rule)) return false
      // Hide password-protected content unless the user has the password stored
      if (rule.password) return unlockPasswords.has(rule.password)
      return true
    }

    const visited = new Set()
    let count = 0

    async function build(filePath, depth) {
      if (depth > MAX_DEPTH || count >= MAX_NODES) return null
      if (visited.has(filePath)) return null
      if (!accessible(filePath)) return null

      visited.add(filePath)

      const buf = await provider.readFile(filePath)
      if (!buf) return null
      count++

      const content = buf.toString('utf-8')
      const title = extractTitle(content, filenameFallback(filePath))
      const rawLinks = extractMarkdownLinks(content, filePath)

      const children = []
      for (const { resolved, isDir } of rawLinks) {
        if (count >= MAX_NODES) break
        const target = isDir
          ? (resolved ? `${resolved}/${indexFile}` : indexFile)
          : resolved
        const child = await build(target, depth + 1)
        if (child) children.push(child)
      }

      return { path: filePath, title, children }
    }

    const tree = await build(indexFile, 0)
    return NextResponse.json(tree ?? null, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    })
  } catch (err) {
    console.error('[sitemap]', err)
    return NextResponse.json(null, { status: 500 })
  }
}
