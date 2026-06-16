import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getContentProvider } from '../../../lib/content-provider.mjs'
import {
  loadSecurityRules,
  loadCookieConfig,
  loadGlobalIndexFile,
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

    const normalizedHref = href.startsWith('/') ? href.slice(1) : href
    const isDir = normalizedHref.endsWith('/')
    const isMarkdown = !isDir && normalizedHref.endsWith('.md')
    if (!isMarkdown && !isDir) continue
    const pathPart = isDir ? normalizedHref.slice(0, -1) : normalizedHref
    const resolved = href.startsWith('/')
      ? pathPart
      : resolvePath(fromFile, pathPart)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)
    links.push({ resolved, isDir })
  }
  return links
}

// Determine the BFS root file and the URL the "Home" node should link to.
//
// Rule: when viewing a file inside a subdirectory, always BFS from that
// folder's index — regardless of whether the folder is linked from the
// global root. This makes the site map contextual (shows what's in *this*
// folder) and handles "obscure" directories that are never linked elsewhere.
//
// The only exception is an explicit `home: 'site'` rule, which forces the
// global root BFS (useful when a subfolder intentionally shows the full map).
//
// `home: 'folder'` and any custom URL only affect the href of the root
// "Home" node, not which files are discovered.
function getRootContext(currentFile, rules, globalIndexFile) {
  const globalRoot = { rootFile: globalIndexFile || 'index.md', rootHref: '/' }

  // No file context, or file is at the content root → global site map
  if (!currentFile || !currentFile.includes('/')) return globalRoot

  const folder = currentFile.split('/')[0]

  // Check for an explicit rule that overrides site-map root behaviour
  let best = null
  for (const rule of rules) {
    if (!rule.match || rule.home === undefined) continue
    const m = rule.match
    const matched = m.endsWith('/') ? currentFile.startsWith(m) : currentFile === m
    if (matched && (!best || m.length > best.match.length)) best = rule
  }
  const homeValue = best?.home

  // Explicit 'site' → honour it and use global root
  if (homeValue === 'site') return globalRoot

  // For all other cases (no rule, 'folder', custom URL, false) when in a
  // subdirectory: BFS from this folder's index so every file in the folder
  // is discoverable whether or not it's linked from the public root.
  const folderIndex = findIndexFile(`${folder}/placeholder.md`, rules, globalIndexFile || 'index.md')
  const rootFile = `${folder}/${folderIndex}`

  // Determine the href for the "Home" node
  let rootHref = `/${folder}/`
  if (homeValue && homeValue !== 'folder' && homeValue !== false && typeof homeValue === 'string') {
    rootHref = homeValue  // custom URL configured in rules
  }

  return { rootFile, rootHref }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const currentFile = searchParams.get('file') || null

    const provider = getContentProvider()
    const [rules, cookieConfig, globalIndexFile] = await Promise.all([
      loadSecurityRules(),
      loadCookieConfig(),
      loadGlobalIndexFile(),
    ])

    let { rootFile, rootHref } = getRootContext(currentFile, rules, globalIndexFile)

    // If the derived index file doesn't exist, fall back to the currently
    // open file — it was explicitly navigated to and can serve as the root.
    if (currentFile && rootFile !== currentFile) {
      const probe = await provider.readFile(rootFile)
      if (!probe) rootFile = currentFile
    }

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

    if (!accessible(rootFile)) {
      return NextResponse.json(null, {
        headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
      })
    }

    const visited    = new Set()
    const crossRefed = new Set()   // paths reachable via multiple routes
    const linksCache = new Map()   // path → parsed link array (avoids re-reading)
    let count = 0

    async function readNode(filePath) {
      const buf = await provider.readFile(filePath)
      if (!buf) return null
      count++
      const content  = buf.toString('utf-8')
      const filename = filenameFallback(filePath)
      const title    = extractTitle(content, filename)
      linksCache.set(filePath, extractMarkdownLinks(content, filePath))
      return { path: filePath, title, filename, children: [] }
    }

    function resolveTarget(resolved, isDir) {
      const localIndex = findIndexFile(resolved + '/placeholder.md', rules, globalIndexFile || 'index.md')
      return isDir ? (resolved ? `${resolved}/${localIndex}` : localIndex) : resolved
    }

    visited.add(rootFile)
    const tree = await readNode(rootFile)

    if (tree) {
      // True BFS: for each node, mark ALL direct link targets as visited before
      // reading any of them. This ensures a file linked at depth N is placed at
      // depth N even if a sibling at depth N also links to it — the sibling will
      // find it already visited and record it as a cross-reference instead.
      const queue = [{ node: tree, depth: 0 }]

      while (queue.length > 0 && count < MAX_NODES) {
        const { node, depth } = queue.shift()
        if (depth >= MAX_DEPTH) continue

        const rawLinks = linksCache.get(node.path) || []

        // Pass 1: resolve targets, mark unvisited+accessible ones as claimed.
        // All siblings are claimed together before any of them are expanded.
        const targets = []
        for (const { resolved, isDir } of rawLinks) {
          if (count >= MAX_NODES) break
          const target = resolveTarget(resolved, isDir)
          if (visited.has(target)) {
            if (accessible(target)) crossRefed.add(target)
            continue
          }
          if (!accessible(target)) continue
          visited.add(target)
          targets.push(target)
        }

        // Pass 2: read each claimed target and attach as a child.
        for (const target of targets) {
          if (count >= MAX_NODES) break
          const child = await readNode(target)
          if (child) {
            node.children.push(child)
            queue.push({ node: child, depth: depth + 1 })
          } else {
            visited.delete(target)  // file not found — free the slot
          }
        }
      }

      // Annotate nodes that are reachable via multiple routes
      if (crossRefed.size > 0) {
        function annotate(node) {
          if (crossRefed.has(node.path)) node.multiRef = true
          node.children?.forEach(annotate)
        }
        annotate(tree)
      }

      tree.rootHref = rootHref
    }

    return NextResponse.json(tree ?? null, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    })
  } catch (err) {
    console.error('[sitemap]', err)
    return NextResponse.json(null, { status: 500 })
  }
}
