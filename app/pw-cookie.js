'use client'

// Client-side helpers for persisting unlock passwords in cookies.
// Mirrors the sessionStorage key scheme: prefix-unlock-{fingerprint}
// where fingerprint is the first 24 chars of the AES-GCM ciphertext
// (same identifier used as the sessionStorage key).

function cookieAttrs(cfg) {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  const domain = cfg.domain ? `; Domain=${cfg.domain}` : ''
  return `; Path=/; Max-Age=${cfg.maxAge}; SameSite=Strict${secure}${domain}`
}

function safeFingerprint(fingerprint) {
  return fingerprint.replace(/[^a-zA-Z0-9]/g, '_')
}

export function unlockCookieName(prefix, fingerprint) {
  return `${prefix}-unlock-${safeFingerprint(fingerprint)}`
}

export function adminCookieName(prefix) {
  return `${prefix}-admin`
}

export function readCookie(name) {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === name)
      return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

export function writeCookie(name, value, cfg) {
  document.cookie = `${name}=${encodeURIComponent(value)}${cookieAttrs(cfg)}`
}

export function deleteCookie(name, cfg) {
  const domain = cfg?.domain ? `; Domain=${cfg.domain}` : ''
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Strict${domain}`
}

// Returns a deduplicated array of all stored unlock passwords from cookies.
export function allCookiePasswords(prefix) {
  const needle = `${prefix}-unlock-`
  const seen = new Set()
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).startsWith(needle)) {
      const v = decodeURIComponent(part.slice(eq + 1))
      if (v) seen.add(v)
    }
  }
  return Array.from(seen)
}

// Returns true if any unlock cookie exists for this prefix.
export function hasAnyCookiePassword(prefix) {
  return document.cookie.split('; ').some(p => p.startsWith(`${prefix}-unlock-`))
}
