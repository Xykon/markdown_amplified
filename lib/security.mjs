import fs from 'fs'
import path from 'path'
import { webcrypto } from 'node:crypto'
import { dbg } from './logger.mjs'

const PBKDF2_ITERATIONS = 600_000
const DEFAULT_GITHUB_URL = 'https://github.com/Xykon/markdown_amplified'

function normalizeRulePath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim()
  if (raw === '/') return '/'
  return raw.replace(/^\/+/, '').replace(/\/+/g, '/')
}

export function ruleMatchesPath(filePath, ruleMatch) {
  const path = normalizeRulePath(filePath)
  const match = normalizeRulePath(ruleMatch)

  if (match === '/') return !path.includes('/')
  if (match.endsWith('/')) {
    const folder = match.slice(0, -1)
    return path === folder || path === match || path.startsWith(match)
  }
  return path === match
}

let _configCache = null
let _configCacheAt = 0
let _configInflight = null   // deduplicates concurrent calls before cache is warm
let _configPath = null       // the file it came from, when that is a local path
let _configStamp = null      // that file's mtime and size when it was read
const CONFIG_TTL_MS = 60_000

export function invalidateConfigCache() {
  _configCache = null
  _configCacheAt = 0
  _configInflight = null
  _configPath = null
  _configStamp = null
}

// mtime and size, as one comparable string. Null when the file is gone, which compares unequal to
// any real stamp and so counts as a change — a deleted config should stop applying, not linger.
function fileStamp(filePath) {
  try {
    const s = fs.statSync(filePath)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return null
  }
}

function env(v) {
  return (!v || /^null$/i.test(v)) ? '' : v
}

function forceReadonlyAdminMode() {
  const isLambdaRuntime = Boolean(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME)
  return isLambdaRuntime && !env(process.env.S3_BUCKET)
}

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
    // On a local filesystem the cache does not have to guess. The TTL exists because on S3 every
    // check is a network round trip, so the only affordable answer is "assume unchanged for a
    // minute" — but here the same question is one `stat`, and the difference is not academic: the
    // file carries the admin password, and rotating it by rsync left the old one working for up to
    // a minute with nothing on the box to say why.
    //
    // `_configPath` is null on S3 and when no file was found at all, and both keep the old
    // behaviour. The TTL stays underneath this as the backstop for the case a stamp cannot see:
    // the *active directory* changing, when `content/` gains its first markdown file and the
    // config resolves out of `content/` instead of `content.default/`.
    if (_configPath === null || fileStamp(_configPath) === _configStamp) {
      dbg('security: config cache hit')
      return _configCache
    }
    dbg('security: config file changed on disk, reloading')
  }

  if (_configInflight) {
    dbg('security: config awaiting in-flight fetch')
    return _configInflight
  }

  _configInflight = (async () => {
    let buf = null
    let source = 'none'
    let sourcePath = null

    const rootPath = path.join(process.cwd(), 'content-security.json')
    if (fs.existsSync(rootPath)) {
      try { buf = fs.readFileSync(rootPath); source = 'root-file'; sourcePath = rootPath } catch { /* ignore */ }
    }

    if (!buf) {
      try {
        const { getContentProvider } = await import('./content-provider.mjs')
        const provider = getContentProvider()
        buf = await provider.readFile('content-security.json')
        source = 'content-provider'
        // Where it looked, not where it found something — so a file that is *absent* is watched
        // for too. Stamping only a successful read meant a deleted config turned the watch off,
        // and restoring it then waited out the TTL like before.
        //
        // Only the filesystem provider offers this. On S3 there is no local path to stat, so this
        // stays null and the TTL alone governs, exactly as before.
        if (typeof provider.resolvePath === 'function') {
          sourcePath = provider.resolvePath('content-security.json')
        }
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
    // Stamped before the cache is served, so the next caller compares against the file as it was
    // when it was read rather than as it is now. A missing file stamps as null, which is a real
    // value here: it matches while the file stays missing and differs the moment one appears.
    _configPath = sourcePath
    _configStamp = sourcePath ? fileStamp(sourcePath) : null
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
  return forceReadonlyAdminMode()
    ? { ...admin, readonly: true }
    : admin
}

// Returns { gaId, consentBanner, privacyUrl, privacyLabel } when analytics is configured, or null.
// gaId is validated against the GA4 measurement ID format to prevent injection.
export async function loadAnalyticsConfig() {
  const config = await loadConfig()
  const raw = config.ga_measurement_id
  if (typeof raw !== 'string' || !/^G-[A-Z0-9]+$/i.test(raw.trim())) return null
  const privacyUrl = typeof config.ga_privacy_url === 'string' && config.ga_privacy_url.trim()
    ? config.ga_privacy_url.trim() : null
  const privacyLabel = privacyUrl && typeof config.ga_privacy_label === 'string' && config.ga_privacy_label.trim()
    ? config.ga_privacy_label.trim() : 'Privacy Policy'
  return {
    gaId: raw.trim().toUpperCase(),
    consentBanner: config.ga_consent_banner !== false,
    privacyUrl,
    privacyLabel,
  }
}

export async function loadSecurityRules() {
  const config = await loadConfig()
  return Array.isArray(config.rules) ? config.rules : []
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

// Returns the top-level 'indexFile' default from content-security.json, or null.
export async function loadGlobalIndexFile() {
  const config = await loadConfig()
  return config.indexFile ?? null
}

// Returns the top-level display config fields from content-security.json.
export async function loadGlobalDisplayConfig() {
  const config = await loadConfig()
  return {
    show_toc:              config.show_toc,
    show_sitemap:          config.show_sitemap,
    show_sitemap_first:    config.show_sitemap_first,
    show_sitemap_siteroot: config.show_sitemap_siteroot,
  }
}

// Returns optional global SEO settings from content-security.json.
export async function loadGlobalSeo() {
  const config = await loadConfig()
  const str = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null
  return {
    siteUrl: str(config.siteUrl || config.site_url),
    defaultDescription: str(config.description || config.defaultDescription || config.default_description),
  }
}

// Resolves display config for a given file path.
// Per-rule values take precedence over global config; most-specific match wins.
// Defaults: show_toc=true, show_sitemap=true, show_sitemap_first=false, show_sitemap_siteroot=false, show_siteroot=false
export function findDisplayConfig(filePath, rules, global) {
  const KEYS = ['show_toc', 'show_sitemap', 'show_sitemap_first', 'show_sitemap_siteroot', 'sitemap', 'show_siteroot', 'sitemap_labels']
  const best = {}
  for (const rule of rules) {
    if (!rule.match) continue
    const m = rule.match
    const matched = ruleMatchesPath(filePath, m)
    if (!matched) continue
    for (const k of KEYS) {
      if (rule[k] !== undefined && (!best[k] || m.length > best[k].match.length)) best[k] = rule
    }
  }
  const get = (k, def) => best[k] ? best[k][k] : (global?.[k] ?? def)
  return {
    showToc:             get('show_toc',              true)  !== false,
    showSitemap:         get('show_sitemap',          true)  !== false,
    sitemapOpen:         get('sitemap',               false) === true,
    showSitemapFirst:    get('show_sitemap_first',    false) === true,
    showSitemapSiteroot: get('show_sitemap_siteroot', false) === true,
    showSiteroot:        get('show_siteroot',         false) === true,
    sitemapLabels:       get('sitemap_labels',        'heading') === 'filename' ? 'filename' : 'heading',
  }
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
      config.bannerDark !== undefined) out.hasBanner = true
  return out
}

// Returns the top-level site header fields including siteButton config.
// siteButton is global-only (not per-path).
export async function loadGlobalSiteHeader() {
  const config = await loadConfig()
  const str = (v) => (typeof v === 'string' && v) ? v : null
  let siteButton = null
  const b = config.siteButton
  if (b && typeof b === 'object' && (b.icon || b.iconLight || b.iconDark)) {
    siteButton = {
      icon:      str(b.icon),
      iconLight: str(b.iconLight),
      iconDark:  str(b.iconDark),
      url:       str(b.url),
      placement: b.placement === 'left' ? 'left' : 'right',
      alignment: (b.alignment === 'left' || b.alignment === 'center') ? b.alignment : 'right',
      alt:       str(b.alt),
    }
  }
  return {
    name:        str(config.name),
    banner:      str(config.banner),
    bannerLight: str(config.bannerLight),
    bannerDark:  str(config.bannerDark),
    githubUrl:   str(config.githubUrl) || str(config.github_url) || DEFAULT_GITHUB_URL,
    siteButton,
  }
}

// Returns the resolved { name, banner, bannerLight, bannerDark, siteButton } for a specific
// file path. Banner fields use the most specific matching rule, falling back to global.
// siteButton is global-only and passed through unchanged.
export function findSiteHeader(filePath, rules, global) {
  let bestName        = null
  let bestBanner      = null
  let bestBannerLight = null
  let bestBannerDark  = null
  let bestGithubUrl   = null
  for (const rule of rules) {
    if (!rule.match) continue
    const m = rule.match
    const matched = ruleMatchesPath(filePath, m)
    if (!matched) continue
    if (rule.name        !== undefined && (!bestName        || m.length > bestName.match.length))        bestName        = rule
    if (rule.banner      !== undefined && (!bestBanner      || m.length > bestBanner.match.length))      bestBanner      = rule
    if (rule.bannerLight !== undefined && (!bestBannerLight || m.length > bestBannerLight.match.length)) bestBannerLight = rule
    if (rule.bannerDark  !== undefined && (!bestBannerDark  || m.length > bestBannerDark.match.length))  bestBannerDark  = rule
    if (rule.githubUrl   !== undefined && (!bestGithubUrl   || m.length > bestGithubUrl.match.length))   bestGithubUrl   = rule
  }
  return {
    name:        bestName        !== null ? bestName.name               : (global.name        ?? null),
    banner:      bestBanner      !== null ? bestBanner.banner           : (global.banner      ?? null),
    bannerLight: bestBannerLight !== null ? bestBannerLight.bannerLight : (global.bannerLight ?? null),
    bannerDark:  bestBannerDark  !== null ? bestBannerDark.bannerDark   : (global.bannerDark  ?? null),
    githubUrl:   bestGithubUrl   !== null ? bestGithubUrl.githubUrl     : (global.githubUrl   ?? DEFAULT_GITHUB_URL),
    siteButton:  global.siteButton ?? null,
  }
}

export function findGitHubUrl(filePath, rules, globalGithubUrl) {
  let best = null
  for (const rule of rules) {
    if (!rule.match || rule.githubUrl === undefined) continue
    const m = rule.match
    const matched = ruleMatchesPath(filePath, m)
    if (matched && (!best || m.length > best.match.length)) best = rule
  }
  const value = best !== null ? best.githubUrl : (globalGithubUrl ?? DEFAULT_GITHUB_URL)
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_GITHUB_URL
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
    const matched = ruleMatchesPath(filePath, m)
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
    const matched = ruleMatchesPath(filePath, m)
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
    const matched = ruleMatchesPath(filePath, m)
    if (matched && (!best || m.length > best.match.length)) best = rule
  }
  const value = best !== null ? best.toc : (globalToc ?? true)
  return value !== false
}

// Returns the index filename for a given file path (e.g., "README.md", "index.md").
// Rule-level indexFile takes precedence; otherwise uses globalIndexFile.
// Default is "index.md" if no config set.
export function findIndexFile(filePath, rules, globalIndexFile) {
  let best = null
  for (const rule of rules) {
    if (!rule.match || rule.indexFile === undefined) continue
    const m = rule.match
    const matched = ruleMatchesPath(filePath, m)
    if (matched && (!best || m.length > best.match.length)) best = rule
  }
  return best !== null ? best.indexFile : (globalIndexFile || 'index.md')
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
