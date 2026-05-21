import fs from 'fs'
import path from 'path'
import { webcrypto } from 'node:crypto'
import { dbg } from './logger.mjs'

const PBKDF2_ITERATIONS = 600_000

let _configCache = null
let _configCacheAt = 0
let _configInflight = null   // deduplicates concurrent calls before cache is warm
const CONFIG_TTL_MS = 60_000

// Reads and caches the full content-security.json config object.
// Priority: project root > content provider (S3 or active content dir).
// This lets a root-level content-security.json override the one shipped
// inside content.default, while S3 deployments (no root file) use the
// bucket copy as before.
//
// Concurrent callers that arrive while a fetch is already in-flight all
// await the same promise, so only one S3 read happens per cache miss.
async function loadConfig() {
  if (_configCache !== null && Date.now() - _configCacheAt < CONFIG_TTL_MS) {
    dbg('security: config cache hit')
    return _configCache
  }

  if (_configInflight) {
    dbg('security: config awaiting in-flight fetch')
    return _configInflight
  }

  _configInflight = (async () => {
    let buf = null
    let source = 'none'

    const rootPath = path.join(process.cwd(), 'content-security.json')
    if (fs.existsSync(rootPath)) {
      try { buf = fs.readFileSync(rootPath); source = 'root-file' } catch { /* ignore */ }
    }

    if (!buf) {
      try {
        const { getContentProvider } = await import('./content-provider.mjs')
        const provider = getContentProvider()
        buf = await provider.readFile('content-security.json')
        source = 'content-provider'
      } catch {
        // provider unavailable
      }
    }

    let result
    try {
      result = buf ? JSON.parse(buf.toString('utf-8')) : {}
    } catch {
      result = {}
    }

    _configCache = result
    _configCacheAt = Date.now()
    _configInflight = null
    dbg(`security: loaded config from ${source}, rules=${(result.rules?.length ?? 0)}, admin=${!!result.admin}`)
    return result
  })()

  return _configInflight
}

// Returns the admin config if admin is enabled, or null.
// Admin is enabled when content-security.json has an "admin" object with
// a non-empty "password" and "enabled" is not explicitly false.
export async function loadCookieConfig() {
  const config = await loadConfig()
  const c = config.cookies
  if (!c || typeof c !== 'object' || c.enabled !== true) return null
  return {
    prefix:     (typeof c.prefix === 'string' && c.prefix) ? c.prefix : 'md',
    maxAge:     (typeof c.maxAge === 'number' && c.maxAge > 0) ? c.maxAge : 2592000,
    domain:     (typeof c.domain === 'string' && c.domain) ? c.domain : null,
    storeAdmin: c.storeAdmin === true,
  }
}

export async function loadAdminConfig() {
  const config = await loadConfig()
  const admin = config.admin
  if (!admin || typeof admin !== 'object') return null
  if (admin.enabled === false) return null
  if (!admin.password) return null
  return admin
}

export async function loadSecurityRules() {
  const config = await loadConfig()
  return Array.isArray(config.rules) ? config.rules : []
}

// Returns the top-level 'name' from content-security.json, or the default app name.
export async function loadSiteName() {
  const config = await loadConfig()
  return (typeof config.name === 'string' && config.name) ? config.name : 'Markdown Amplified'
}

// Returns the top-level 'home' default from content-security.json, or null.
export async function loadGlobalHome() {
  const config = await loadConfig()
  return config.home ?? null
}

// Returns the top-level 'toc' default from content-security.json, or null.
export async function loadGlobalToc() {
  const config = await loadConfig()
  return config.toc ?? null
}

// Returns security-relevant global settings for use in the admin file browser
// root row. Only properties that are explicitly configured are included.
export async function loadRootSecurity() {
  const config = await loadConfig()
  const out = {}
  if (config.toc !== undefined) out.toc = config.toc
  if (config.home !== undefined) out.hasHome = true
  if (config.name !== undefined) out.hasName = true
  if (config.banner !== undefined || config.bannerLight !== undefined ||
      config.bannerDark !== undefined || config.homeIcon !== undefined) out.hasBanner = true
  return out
}

// Returns the top-level { name, banner, bannerLight, bannerDark, homeIcon } for the site.
// All fields are null if not set.
export async function loadGlobalSiteHeader() {
  const config = await loadConfig()
  const str = (v) => (typeof v === 'string' && v) ? v : null
  return {
    name:        str(config.name),
    banner:      str(config.banner),
    bannerLight: str(config.bannerLight),
    bannerDark:  str(config.bannerDark),
    homeIcon:    str(config.homeIcon),
  }
}

// Returns the resolved { name, banner, bannerLight, bannerDark, homeIcon } for a specific
// file path. Each field uses the most specific matching rule that defines it, falling back
// to the global value when no rule matches.
export function findSiteHeader(filePath, rules, global) {
  let bestName        = null
  let bestBanner      = null
  let bestBannerLight = null
  let bestBannerDark  = null
  let bestHomeIcon    = null
  for (const rule of rules) {
    if (!rule.match) continue
    const m = rule.match
    const matched = m.endsWith('/') ? filePath.startsWith(m) : filePath === m
    if (!matched) continue
    if (rule.name        !== undefined && (!bestName        || m.length > bestName.match.length))        bestName        = rule
    if (rule.banner      !== undefined && (!bestBanner      || m.length > bestBanner.match.length))      bestBanner      = rule
    if (rule.bannerLight !== undefined && (!bestBannerLight || m.length > bestBannerLight.match.length)) bestBannerLight = rule
    if (rule.bannerDark  !== undefined && (!bestBannerDark  || m.length > bestBannerDark.match.length))  bestBannerDark  = rule
    if (rule.homeIcon    !== undefined && (!bestHomeIcon    || m.length > bestHomeIcon.match.length))    bestHomeIcon    = rule
  }
  return {
    name:        bestName        !== null ? bestName.name               : (global.name        ?? null),
    banner:      bestBanner      !== null ? bestBanner.banner           : (global.banner      ?? null),
    bannerLight: bestBannerLight !== null ? bestBannerLight.bannerLight : (global.bannerLight ?? null),
    bannerDark:  bestBannerDark  !== null ? bestBannerDark.bannerDark   : (global.bannerDark  ?? null),
    homeIcon:    bestHomeIcon    !== null ? bestHomeIcon.homeIcon       : (global.homeIcon    ?? null),
  }
}

// Returns the most specific matching rule for a given file path.
// filePath is relative to the content dir, forward slashes (e.g. "private/doc.md").
// Directory rules end with "/" and match any file under that directory.
// File rules match exactly. Longer match length wins.
export function findRule(filePath, rules) {
  let best = null
  for (const rule of rules) {
    if (!rule.match) continue
    const m = rule.match
    const matched = m.endsWith('/') ? filePath.startsWith(m) : filePath === m
    if (matched && (!best || m.length > best.match.length)) {
      best = rule
    }
  }
  dbg(`security: findRule(${filePath}) → ${best ? `match='${best.match}' pw=${!!best.password}` : 'no match'}`)
  return best
}

// Returns the resolved home URL for a given file, or null if disabled.
// home values: "site" → "/", "folder" → top-level folder root,
// any other string → treated as a custom URL, false → disabled.
// Rule-level home takes precedence over globalHome.
export function findHomeUrl(filePath, rules, globalHome) {
  let best = null
  for (const rule of rules) {
    if (!rule.match || rule.home === undefined) continue
    const m = rule.match
    const matched = m.endsWith('/') ? filePath.startsWith(m) : filePath === m
    if (matched && (!best || m.length > best.match.length)) best = rule
  }

  // Default is 'site' when no explicit config is provided
  const value = best !== null ? best.home : (globalHome ?? 'site')
  if (!value || value === false) return null
  if (value === 'site') return '/'
  if (value === 'folder') {
    const first = filePath.split('/')[0]
    return filePath.includes('/') ? `/${first}/` : '/'
  }
  return typeof value === 'string' ? value : null
}

// Returns whether the TOC should open by default for a given file.
// Default is true. Set toc: false globally or per rule to start it closed.
export function findTocOpen(filePath, rules, globalToc) {
  let best = null
  for (const rule of rules) {
    if (!rule.match || rule.toc === undefined) continue
    const m = rule.match
    const matched = m.endsWith('/') ? filePath.startsWith(m) : filePath === m
    if (matched && (!best || m.length > best.match.length)) best = rule
  }
  const value = best !== null ? best.toc : (globalToc ?? true)
  return value !== false
}

// Returns whether the source markdown file may be downloaded.
// Explicit rule.download field takes precedence; otherwise defaults to
// false for password-protected files and true for everything else.
export function isDownloadAllowed(rule) {
  if (!rule) return true
  if (rule.download !== undefined) {
    // Guard against the common JSON mistake of "false" (string) instead of false (boolean)
    return rule.download !== false && rule.download !== 'false'
  }
  return !rule.password
}

export function isWithinDateRange(rule) {
  if (!rule) return true
  const now = new Date()
  if (rule.validFrom && now < new Date(rule.validFrom)) return false
  if (rule.validUntil && now > new Date(rule.validUntil)) return false
  return true
}

const _encryptCache = new Map()

// Encrypts plaintext with AES-256-GCM using PBKDF2 key derivation.
// Returns { salt, iv, ciphertext } as base64 strings.
// Result is cached per (plaintext, password) pair — content and passwords
// don't change at runtime, so re-deriving the key each request is wasteful.
export async function encryptContent(plaintext, password) {
  const cacheKey = password + '\0' + plaintext
  const cached = _encryptCache.get(cacheKey)
  if (cached) return cached
  const { subtle, getRandomValues } = webcrypto
  const enc = new TextEncoder()
  const salt = getRandomValues(new Uint8Array(16))
  const iv = getRandomValues(new Uint8Array(12))

  const keyMaterial = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))

  const result = {
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  }
  _encryptCache.set(cacheKey, result)
  return result
}
