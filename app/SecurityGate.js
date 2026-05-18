'use client'

import { useEffect, useRef, useState } from 'react'
import MarkdownShell from './MarkdownShell'
import { unlockCookieName, readCookie, writeCookie, allCookiePasswords } from './pw-cookie'

const PBKDF2_ITERATIONS = 600_000

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function decryptContent(encrypted, password) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(encrypted.salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encrypted.iv) },
    key,
    fromBase64(encrypted.ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

function sessionKey(encrypted) {
  return `md-unlock:${encrypted.ciphertext.slice(0, 24)}`
}

// Collect all candidate passwords from sessionStorage + cookies, deduplicated.
function collectPasswords(currentKey, cookieConfig) {
  const seen = new Set()
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    if (!k?.startsWith('md-unlock:') || k === currentKey) continue
    const v = sessionStorage.getItem(k)
    if (v) seen.add(v)
  }
  if (cookieConfig) {
    for (const pw of allCookiePasswords(cookieConfig.prefix)) seen.add(pw)
  }
  return Array.from(seen)
}

// Try every password cached from other protected pages.
// If one decrypts this ciphertext, cache it and return the plaintext.
async function tryStoredPasswords(encrypted, cookieConfig) {
  const key = sessionKey(encrypted)
  for (const password of collectPasswords(key, cookieConfig)) {
    try {
      const text = await decryptContent(encrypted, password)
      sessionStorage.setItem(key, password)
      return text
    } catch { /* wrong password — try next */ }
  }
  return null
}

function LockIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

// Renders content behind an optional password and/or date-range gate.
// - encrypted: { salt, iv, ciphertext } when password-protected, otherwise null/undefined
// - validFrom / validUntil: ISO date strings for date-range gating, or null/undefined
// - content: plaintext markdown for date-only pages, null for password-protected pages
// - hasDownload: whether the download button is shown (mirrors the downloads route)
// After any gate is cleared, delegates to MarkdownShell for normal rendering.
export default function SecurityGate({ slug, content, encrypted, validFrom, validUntil, hasDownload, homeUrl, tocOpen, cookieConfig }) {
  const [phase, setPhase] = useState('init')
  const [resolvedContent, setResolvedContent] = useState(content)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!encrypted && !validFrom && !validUntil) {
      setPhase('open')
      return
    }

    const now = new Date()
    if (validFrom && now < new Date(validFrom)) {
      setPhase('date-locked')
      return
    }
    if (validUntil && now > new Date(validUntil)) {
      setPhase('date-locked')
      return
    }

    if (!encrypted) {
      setPhase('open')
      return
    }

    const key = sessionKey(encrypted)
    let cached = sessionStorage.getItem(key)
    // Fall back to cookie if sessionStorage has no entry (e.g. new tab/session)
    if (!cached && cookieConfig) {
      cached = readCookie(unlockCookieName(cookieConfig.prefix, encrypted.ciphertext.slice(0, 24)))
      if (cached) sessionStorage.setItem(key, cached)
    }
    if (cached) {
      decryptContent(encrypted, cached)
        .then((text) => {
          setResolvedContent(text)
          setPhase('open')
        })
        .catch(() => {
          sessionStorage.removeItem(key)
          setPhase('password')
        })
    } else {
      tryStoredPasswords(encrypted, cookieConfig).then((text) => {
        if (text !== null) {
          setResolvedContent(text)
          setPhase('open')
        } else {
          setPhase('password')
        }
      })
    }
  }, [])

  useEffect(() => {
    if (phase === 'password') inputRef.current?.focus()
  }, [phase])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const text = await decryptContent(encrypted, password)
      const sKey = sessionKey(encrypted)
      sessionStorage.setItem(sKey, password)
      if (cookieConfig)
        writeCookie(unlockCookieName(cookieConfig.prefix, encrypted.ciphertext.slice(0, 24)), password, cookieConfig)
      setResolvedContent(text)
      setPhase('open')
    } catch {
      setError('Incorrect password')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'init') return null

  if (phase === 'open') {
    return <MarkdownShell slug={slug} content={resolvedContent} hasDownload={hasDownload} homeUrl={homeUrl} tocOpen={tocOpen} cookieConfig={cookieConfig} />
  }

  if (phase === 'date-locked') {
    const upcoming = validFrom && new Date() < new Date(validFrom)
    return (
      <div className="security-gate-wrap">
        <div className="security-gate">
          <div className="security-gate-icon"><CalendarIcon /></div>
          <p className="security-gate-heading">
            {upcoming ? 'Not yet available' : 'No longer available'}
          </p>
          {upcoming && validFrom && (
            <p className="security-gate-sub">
              {'Available from '}
              {new Date(validFrom).toLocaleDateString(undefined, { dateStyle: 'long' })}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="security-gate-wrap">
      <form className="security-gate" onSubmit={handleSubmit} noValidate>
        <div className="security-gate-icon"><LockIcon /></div>
        <p className="security-gate-heading">Password protected</p>
        <div className="security-gate-row">
          {/* Hidden username field — password managers require a username+password
              pair to offer save/autofill. The page path acts as the username so
              each protected page gets its own entry in the password manager. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={slug ? slug.join('/') : ''}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
          />
          <input
            ref={inputRef}
            id="password"
            name="password"
            type="password"
            className="security-gate-input"
            placeholder="Enter password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError('') }}
            autoComplete="current-password"
            disabled={submitting}
          />
          <button
            type="submit"
            className="security-gate-button"
            disabled={submitting || !password}
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
        {error && <p className="security-gate-error" role="alert">{error}</p>}
      </form>
    </div>
  )
}
