import fs from 'fs'
import path from 'path'
import { webcrypto } from 'node:crypto'

const PBKDF2_ITERATIONS = 100_000

let _rulesCache = null
let _rulesCacheAt = 0
const RULES_TTL_MS = 60_000

// Loads security rules from content-security.json.
// Reads via the content provider (S3 or filesystem content dir) first,
// then falls back to the project root for local deployments that keep
// the file there.  Result is cached for RULES_TTL_MS so S3 updates are
// picked up without requiring a Lambda cold start.
export async function loadSecurityRules() {
  if (_rulesCache && Date.now() - _rulesCacheAt < RULES_TTL_MS) return _rulesCache

  let buf = null

  try {
    const { getContentProvider } = await import('./content-provider.mjs')
    const provider = getContentProvider()
    buf = await provider.readFile('content-security.json')
  } catch {
    // provider unavailable — fall through to filesystem fallback
  }

  if (!buf) {
    const legacyPath = path.join(process.cwd(), 'content-security.json')
    if (fs.existsSync(legacyPath)) {
      try { buf = fs.readFileSync(legacyPath) } catch { /* ignore */ }
    }
  }

  if (!buf) {
    _rulesCache = []
    _rulesCacheAt = Date.now()
    return _rulesCache
  }

  try {
    const data = JSON.parse(buf.toString('utf-8'))
    _rulesCache = Array.isArray(data.rules) ? data.rules : []
  } catch {
    _rulesCache = []
  }

  _rulesCacheAt = Date.now()
  return _rulesCache
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
  return best
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
