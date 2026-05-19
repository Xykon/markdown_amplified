'use client'

import { useEffect, useRef, useState } from 'react'
import Header from '../../Header'
import { unlockCookieName, readCookie, writeCookie, allCookiePasswords } from '../../pw-cookie'

const PBKDF2_ITERATIONS = 600_000

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

async function verifyPassword(encrypted, password) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(encrypted.salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(encrypted.iv) }, key, fromBase64(encrypted.ciphertext))
}

function sessionKey(encrypted) {
  return `md-unlock:${encrypted.ciphertext.slice(0, 24)}`
}

async function triggerDownload(relPath, password, filename) {
  const encodedPath = relPath.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(`/api/asset-download/${encodedPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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

function DownloadIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

export default function AssetGate({ relPath, filename, encrypted, validFrom, validUntil, homeUrl, cookieConfig, siteName }) {
  const [phase, setPhase] = useState('init')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [backUrl, setBackUrl] = useState(null)
  const verifiedPasswordRef = useRef(null)
  const inputRef = useRef(null)

  // Detect a same-origin referrer to offer a "Back to document" link
  useEffect(() => {
    try {
      const ref = document.referrer
      if (ref) {
        const u = new URL(ref)
        if (u.origin === window.location.origin && !u.pathname.startsWith('/gate/')) {
          setBackUrl(ref)
        }
      }
    } catch {}
  }, [])

  async function doDownload(pw) {
    setError('')
    try {
      await triggerDownload(relPath, pw, filename)
    } catch {
      setError('Download failed. Please try again.')
    }
  }

  // Transition to the ready/download phase and auto-start the download
  function readyWithPassword(pw) {
    verifiedPasswordRef.current = pw
    if (encrypted) {
      sessionStorage.setItem(sessionKey(encrypted), pw)
      if (cookieConfig)
        writeCookie(unlockCookieName(cookieConfig.prefix, encrypted.ciphertext.slice(0, 24)), pw, cookieConfig)
    }
    setPhase('ready')
    doDownload(pw)
  }

  useEffect(() => {
    const now = new Date()
    if (validFrom && now < new Date(validFrom)) { setPhase('date-locked'); return }
    if (validUntil && now > new Date(validUntil)) { setPhase('date-locked'); return }

    if (!encrypted) { setPhase('password'); return }

    // Try the specific cached password for this ciphertext
    const key = sessionKey(encrypted)
    let cached = sessionStorage.getItem(key)
    if (!cached && cookieConfig) {
      cached = readCookie(unlockCookieName(cookieConfig.prefix, encrypted.ciphertext.slice(0, 24)))
      if (cached) sessionStorage.setItem(key, cached)
    }
    if (cached) {
      verifyPassword(encrypted, cached)
        .then(() => readyWithPassword(cached))
        .catch(() => {
          sessionStorage.removeItem(key)
          setPhase('password')
        })
      return
    }

    // Try passwords cached from other protected pages (sessionStorage + cookies)
    ;(async () => {
      const seen = new Set()
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (!k?.startsWith('md-unlock:') || k === key) continue
        const pw = sessionStorage.getItem(k)
        if (pw) seen.add(pw)
      }
      if (cookieConfig) {
        for (const pw of allCookiePasswords(cookieConfig.prefix)) seen.add(pw)
      }
      for (const pw of seen) {
        try {
          await verifyPassword(encrypted, pw)
          readyWithPassword(pw)
          return
        } catch { /* wrong password — try next */ }
      }
      setPhase('password')
    })()
  }, [])

  useEffect(() => {
    if (phase === 'password') inputRef.current?.focus()
  }, [phase])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await verifyPassword(encrypted, password)
      readyWithPassword(password)
    } catch {
      setError('Incorrect password')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'init') return null

  const header = <Header slug={null} hasToc={false} homeUrl={homeUrl} siteName={siteName} />

  if (phase === 'date-locked') {
    const upcoming = validFrom && new Date() < new Date(validFrom)
    return (
      <>
        {header}
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
      </>
    )
  }

  if (phase === 'ready') {
    const downloadBtn = (
      <button
        type="button"
        className="security-gate-button"
        onClick={() => doDownload(verifiedPasswordRef.current)}
      >
        Download
      </button>
    )

    return (
      <>
        {header}
        <div className="security-gate-wrap">
          <div className="security-gate">
            <div className="security-gate-icon"><DownloadIcon /></div>
            <p className="security-gate-heading">{filename}</p>
            <p className="security-gate-sub">
              If your download does not begin automatically in a few seconds, press the download button below.
            </p>
            {error && <p className="security-gate-error" role="alert">{error}</p>}
            {backUrl ? (
              <div className="security-gate-row">
                {downloadBtn}
                <a
                  href={backUrl}
                  className="security-gate-button"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    textDecoration: 'none',
                    textAlign: 'center',
                  }}
                >
                  ← Back to document
                </a>
              </div>
            ) : (
              downloadBtn
            )}
          </div>
        </div>
      </>
    )
  }

  // phase === 'password'
  return (
    <>
      {header}
      <div className="security-gate-wrap">
        <form className="security-gate" onSubmit={handleSubmit} noValidate>
          <div className="security-gate-icon"><LockIcon /></div>
          <p className="security-gate-heading">Password protected</p>
          <p className="security-gate-sub">{filename}</p>
          <div className="security-gate-row">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={relPath}
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
              {submitting ? 'Verifying…' : 'Download'}
            </button>
          </div>
          {error && <p className="security-gate-error" role="alert">{error}</p>}
        </form>
      </div>
    </>
  )
}
