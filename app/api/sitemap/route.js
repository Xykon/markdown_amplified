import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getContentProvider } from '../../../lib/content-provider.mjs'
import {
  loadSecurityRules,
  loadCookieConfig,
  loadGlobalIndexFile,
  loadGlobalHome,
  findRule,
  findIndexFile,
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
  return m[1].trim().replace(/[`*_~[\]()]/g, '').trim() || fallback
}

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

function extractMarkdownLinks(content, fromFile) {
  const links = []
  const seen = new Set()
  const RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g
  for (const [, rawHref] of content.matchAll(RE)) {
    const href = rawHref.split(/[#?]/)[0].trim()
    if (!href) continue
    if (/^[a-z+]+:/i.test(href)) continue
    if (href.startsWith('/')) continue
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

// Determine the BFS root file and the URL the "Home" node should link to,
// based on the same home-rule logic used by findHomeUrl in security.mjs.
function getRootContext(currentFile, rules, globalHome, globalIndexFile) {
  if (!currentFile) {
    return { rootFile: globalIndexFile || 'index.md', rootHref: '/' }
  }

  // Find the most specific matching rule with a home property
  let best = null
  for (const rule of rules) {
    if (!rule.match || rule.home === undefined) continue
    const m = rule.match
    const matched = m.endsWith('/') ? currentFile.startsWith(m) : currentFile === m
    if (matched && (!best || m.length > best.match.length)) best = rule
  }

  const homeValue = best !== null ? best.home : (globalHome ?? 'site')

  if (homeValue === 'folder' && currentFile.includes('/')) {
    const folder = currentFile.split('/')[0]
    const folderIndex = findIndexFile(`${folder}/placeholder.md`, rules, globalIndexFile || 'index.md')
    return {
      rootFile: `${folder}/${folderIndex}`,
      rootHref: `/${folder}/`,
    }
  }

  if (homeValue && homeValue !== 'site' && homeValue !== 'folder' && homeValue !== false && typeof homeValue === 'string') {
    // Custom home URL — BFS still starts from the file's folder index if it's a subfolder,
    // otherwise global root. Use the custom URL for the Home link.
    if (currentFile.includes('/')) {
      const folder = currentFile.split('/')[0]
      const folderIndex = findIndexFile(`${folder}/placeholder.md`, rules, globalIndexFile || 'index.md')
      return { rootFile: `${folder}/${folderIndex}`, rootHref: homeValue }
    }
    return { rootFile: globalIndexFile || 'index.md', rootHref: homeValue }
  }

  // 'site', false, null, or undefined → global root
  return { rootFile: globalIndexFile || 'index.md', rootHref: '/' }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const currentFile = searchParams.get('file') || null

    const provider = getContentProvider()
    const [rules, cookieConfig, globalIndexFile, globalHome] = await Promise.all([
      loadSecurityRules(),
      loadCookieConfig(),
      loadGlobalIndexFile(),
      loadGlobalHome(),
    ])

    const { rootFile, rootHref } = getRootContext(currentFile, rules, globalHome, globalIndexFile)

    // Collect the user's persisted unlock passwords from cookies.
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
      if ((rule.validFrom || rule.validUntil) && !isWithinDateRange(rule)) return false
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
        const localIndex = findIndexFile(resolved + '/placeholder.md', rules, globalIndexFile || 'index.md')
        const target = isDir
          ? (resolved ? `${resolved}/${localIndex}` : localIndex)
          : resolved
        const child = await build(target, depth + 1)
        if (child) children.push(child)
      }

      return { path: filePath, title, children }
    }

    const tree = await build(rootFile, 0)
    if (tree) tree.rootHref = rootHref

    return NextResponse.json(tree ?? null, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    })
  } catch (err) {
    console.error('[sitemap]', err)
    return NextResponse.json(null, { status: 500 })
  }
}
