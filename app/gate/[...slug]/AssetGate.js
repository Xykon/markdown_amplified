'use client'

import { useEffect, useRef, useState } from 'react'
import Header from '../../Header'

const PBKDF2_ITERATIONS = 100_000

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// Attempts to decrypt the challenge ciphertext with the given password.
// Throws if the password is wrong (AES-GCM authentication fails).
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

export default function AssetGate({ relPath, filename, encrypted, validFrom, validUntil, homeUrl }) {
  const [phase, setPhase] = useState('init')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  async function doDownload(pw) {
    try {
      await triggerDownload(relPath, pw, filename)
      setPhase('done')
    } catch {
      setError('Download failed. Please try again.')
      setPhase('password')
    }
  }

  async function tryAutoDownload(pw) {
    try {
      await verifyPassword(encrypted, pw)
      sessionStorage.setItem(sessionKey(encrypted), pw)
      setPhase('downloading')
      await doDownload(pw)
    } catch {
      // Wrong password — don't clear cache entry, just fall through to prompt
    }
  }

  useEffect(() => {
    const now = new Date()
    if (validFrom && now < new Date(validFrom)) { setPhase('date-locked'); return }
    if (validUntil && now > new Date(validUntil)) { setPhase('date-locked'); return }

    if (!encrypted) { setPhase('password'); return }

    // Try the specific cached password for this ciphertext first
    const key = sessionKey(encrypted)
    const cached = sessionStorage.getItem(key)
    if (cached) {
      setPhase('downloading')
      tryAutoDownload(cached).catch(() => {
        sessionStorage.removeItem(key)
        setPhase('password')
      })
      return
    }

    // Try passwords cached from other protected pages in this session
    ;(async () => {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)
        if (!k?.startsWith('md-unlock:') || k === key) continue
        const pw = sessionStorage.getItem(k)
        if (!pw) continue
        try {
          await verifyPassword(encrypted, pw)
          sessionStorage.setItem(key, pw)
          setPhase('downloading')
          await doDownload(pw)
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
      sessionStorage.setItem(sessionKey(encrypted), password)
      setPhase('downloading')
      await doDownload(password)
    } catch (err) {
      if (err.message === 'Download failed') {
        setError('Download failed. Please try again.')
        setPhase('password')
      } else {
        setError('Incorrect password')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'init') return null

  const header = <Header slug={null} hasToc={false} homeUrl={homeUrl} />

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

  if (phase === 'downloading') {
    return (
      <>
        {header}
        <div className="security-gate-wrap">
          <div className="security-gate">
            <div className="security-gate-icon"><DownloadIcon /></div>
            <p className="security-gate-heading">Preparing download…</p>
          </div>
        </div>
      </>
    )
  }

  if (phase === 'done') {
    return (
      <>
        {header}
        <div className="security-gate-wrap">
          <div className="security-gate">
            <div className="security-gate-icon"><DownloadIcon /></div>
            <p className="security-gate-heading">Download started</p>
            <p className="security-gate-sub">{filename}</p>
            <div className="security-gate-row">
              <button
                type="button"
                className="security-gate-button"
                onClick={() => doDownload(sessionStorage.getItem(sessionKey(encrypted)) || password)}
              >
                Download again
              </button>
            </div>
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
