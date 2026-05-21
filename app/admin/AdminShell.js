'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { adminCookieName, readCookie, writeCookie, deleteCookie } from '../pw-cookie'

const TOKEN_KEY = 'admin-token'
const READONLY_KEY = 'admin-readonly'
const ACTIONS_REPEAT_THRESHOLD = 8  // repeat action buttons in tfoot when list is long

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}
function setToken(t) {
  try { sessionStorage.setItem(TOKEN_KEY, t) } catch { }
}
function clearToken(cookieConfig) {
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(READONLY_KEY) } catch { }
  if (cookieConfig) deleteCookie(adminCookieName(cookieConfig.prefix), cookieConfig)
}
function getStoredReadonly() {
  try { return sessionStorage.getItem(READONLY_KEY) === 'true' } catch { return false }
}
function setStoredReadonly(v) {
  try { sessionStorage.setItem(READONLY_KEY, v ? 'true' : 'false') } catch { }
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getToken()}`, ...extra }
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

function buildFileHref(currentPath, fileName) {
  const relPath = currentPath ? `${currentPath}/${fileName}` : fileName
  return fileName.toLowerCase().endsWith('.md') ? `/${relPath}` : `/asset/${relPath}`
}

// ── Security icon SVGs ────────────────────────────────────────────────────────

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2.5" y="6.5" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M4.5 6.5V4a2.5 2.5 0 015 0v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7" cy="9.5" r="1.1" fill="currentColor"/>
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 4v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v7M4.5 7l2.5 3 2.5-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 12h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function NoTocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4h10M2 7h7M2 10h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4"/>
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 11L11 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function NameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 11L6.5 3l4 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 8.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 7L7 1.5 12.5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 5.8V12h3V9.5h2V12h3V5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function BannerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="11" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="4.5" cy="5.5" r="1" stroke="currentColor" strokeWidth="1"/>
      <path d="M1.5 9l3-2.5 2.5 2.5 2-1.5 3.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}


function SecurityIcons({ sec }) {
  if (!sec || Object.keys(sec).length === 0) return null
  return (
    <span className="sec-strip">
      {sec.password && (
        <span className="sec-icon" title="Password protected"><LockIcon /></span>
      )}
      {sec.dateGated && (
        <span
          className={`sec-icon ${sec.dateActive ? 'sec-green' : 'sec-red'}`}
          title={sec.dateActive ? 'Date gated – currently accessible' : 'Date gated – currently restricted'}
        >
          <ClockIcon />
        </span>
      )}
      {sec.downloadExplicit && (
        <span
          className={`sec-icon ${sec.downloadAllowed ? 'sec-green' : 'sec-red'}`}
          title={sec.downloadAllowed ? 'Download allowed' : 'Download disabled'}
        >
          <DownloadIcon />
        </span>
      )}
      {sec.toc === false && (
        <span className="sec-icon sec-red" title="Table of contents disabled"><NoTocIcon /></span>
      )}
      {sec.hasName && (
        <span className="sec-icon sec-muted" title="Custom title"><NameIcon /></span>
      )}
      {sec.hasHome && (
        <span className="sec-icon sec-muted" title="Custom home"><HomeIcon /></span>
      )}
      {sec.hasBanner && (
        <span className="sec-icon sec-muted" title="Custom banner / branding"><BannerIcon /></span>
      )}
    </span>
  )
}

// ── Login form ──────────────────────────────────────────────────────────────

function LoginForm({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return }
      onLogin(data.token, data.readonly)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login">
      <h2>Admin</h2>
      <form onSubmit={handleSubmit} className="admin-login-form">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          className="admin-input"
          autoFocus
          required
        />
        <button type="submit" className="admin-btn admin-btn-primary" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="admin-error">{error}</p>}
      </form>
    </div>
  )
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({ path, onNavigate }) {
  const parts = path ? path.split('/').filter(Boolean) : []
  return (
    <nav className="admin-breadcrumb">
      <button className="admin-breadcrumb-part" onClick={() => onNavigate('')}>Home</button>
      {parts.map((part, i) => (
        <span key={i}>
          <span className="admin-breadcrumb-sep">/</span>
          <button
            className="admin-breadcrumb-part"
            onClick={() => onNavigate(parts.slice(0, i + 1).join('/'))}
          >{part}</button>
        </span>
      ))}
    </nav>
  )
}

// ── File browser ─────────────────────────────────────────────────────────────

function FileBrowser({ onLogout, readonly, cookieConfig }) {
  const [currentPath, setCurrentPath] = useState('')
  const [listing, setListing]         = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [status, setStatus]           = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolderWhere, setShowNewFolderWhere] = useState(null)  // null | 'top' | 'bottom'
  const [uploading, setUploading]     = useState(false)
  const [confirmDir, setConfirmDir]   = useState(null) // { name, fullPath, count, size }
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting]       = useState(false)
  const fileInputRef = useRef(null)

  const load = useCallback(async (path) => {
    setLoading(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/admin/files?path=${encodeURIComponent(path)}`, {
        headers: authHeaders(),
      })
      if (res.status === 401) { clearToken(cookieConfig); onLogout(); return }
      if (!res.ok) { setError('Failed to load directory'); setLoading(false); return }
      setListing(await res.json())
      setCurrentPath(path)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [onLogout])

  useEffect(() => { load('') }, [load])

  function navigate(path) {
    setShowNewFolderWhere(null)
    load(path)
  }

  function toggleNewFolderTop() {
    setShowNewFolderWhere(v => v === 'top' ? null : 'top')
    setNewFolderName('')
  }

  function toggleNewFolderBottom() {
    setShowNewFolderWhere(v => v === 'bottom' ? null : 'bottom')
    setNewFolderName('')
  }

  async function handleDeleteFile(name) {
    const fullPath = currentPath ? `${currentPath}/${name}` : name
    if (!confirm(`Delete "${fullPath}"?`)) return
    setStatus('')
    setError('')
    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(fullPath).replace(/%2F/g, '/')}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (res.status === 401) { clearToken(cookieConfig); onLogout(); return }
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Delete failed'); return }
      setStatus(`Deleted "${name}"`)
      load(currentPath)
    } catch {
      setError('Network error')
    }
  }

  // Try a non-recursive folder delete. If empty, the server removes any
  // directory marker and we refresh. If non-empty, the server returns 409
  // with { count, size } — open the confirmation modal.
  async function handleDeleteDir(name) {
    const fullPath = currentPath ? `${currentPath}/${name}` : name
    setStatus('')
    setError('')
    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(fullPath).replace(/%2F/g, '/')}?type=dir`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (res.status === 401) { clearToken(cookieConfig); onLogout(); return }
      if (res.ok) {
        setStatus(`Deleted "${name}"`)
        load(currentPath)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.error === 'not_empty') {
        setConfirmDir({ name, fullPath, count: data.count ?? 0, size: data.size ?? 0 })
        setConfirmName('')
        return
      }
      if (res.status === 413 && data.error === 'too_large') {
        setError(`Folder is too large to delete from the admin UI (${data.count} items, ${formatSize(data.size)}). Use the AWS CLI or filesystem tools.`)
        return
      }
      setError(data.error || 'Delete failed')
    } catch {
      setError('Network error')
    }
  }

  async function confirmRecursiveDelete() {
    if (!confirmDir) return
    setDeleting(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(confirmDir.fullPath).replace(/%2F/g, '/')}?type=dir&recursive=1`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (res.status === 401) { clearToken(cookieConfig); onLogout(); return }
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        setStatus(`Deleted "${confirmDir.name}" (${data.count ?? confirmDir.count} items)`)
        setConfirmDir(null)
        load(currentPath)
        return
      }
      const data = await res.json().catch(() => ({}))
      if (res.status === 413 && data.error === 'too_large') {
        setError(`Folder is too large to delete from the admin UI (${data.count} items, ${formatSize(data.size)}).`)
      } else {
        setError(data.error || 'Delete failed')
      }
      setConfirmDir(null)
    } catch {
      setError('Network error')
      setConfirmDir(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setError('')
    setStatus('')
    let uploaded = 0
    for (const file of files) {
      const relPath = currentPath ? `${currentPath}/${file.name}` : file.name
      try {
        const res = await fetch(`/api/admin/files?path=${encodeURIComponent(relPath)}`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
          body: file,
        })
        if (res.status === 401) { clearToken(cookieConfig); onLogout(); return }
        if (!res.ok) { const d = await res.json(); setError(d.error || `Upload failed: ${file.name}`); break }
        uploaded++
      } catch {
        setError(`Network error uploading ${file.name}`)
        break
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (uploaded > 0) {
      setStatus(`Uploaded ${uploaded} file${uploaded > 1 ? 's' : ''}`)
      load(currentPath)
    }
  }

  async function handleCreateFolder(e) {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name) return
    const relPath = currentPath ? `${currentPath}/${name}` : name
    setError('')
    setStatus('')
    try {
      const res = await fetch('/api/admin/mkdir', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: relPath }),
      })
      if (res.status === 401) { clearToken(cookieConfig); onLogout(); return }
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Create folder failed'); return }
      setStatus(`Created folder "${name}"`)
      setNewFolderName('')
      setShowNewFolderWhere(null)
      load(currentPath)
    } catch {
      setError('Network error')
    }
  }

  const totalItems = (listing?.dirs.length ?? 0) + (listing?.files.length ?? 0)
  const showBottomActions = !readonly && totalItems >= ACTIONS_REPEAT_THRESHOLD

  // Column layout:
  // colLeft  = Name + Security + Size  (form fits above these)
  // colRight = Modified + Delete(rw only)  (action buttons sit above these)
  const colLeft  = 3
  const colRight = readonly ? 1 : 2
  const colTotal = colLeft + colRight

  return (
    <div>
      <table className="admin-table">
        <thead>
          {/* Row 1: breadcrumb (left) + Sign out (right, same cell) */}
          <tr className="admin-util-row">
            <td colSpan={colTotal} className="admin-util-cell">
              <div className="admin-util-topbar">
                <Breadcrumb path={currentPath} onNavigate={navigate} />
                <button className="admin-btn admin-btn-danger" onClick={() => { clearToken(cookieConfig); onLogout() }}>
                  Sign out
                </button>
              </div>
              {error && <p className="admin-error admin-error-bar">{error}</p>}
              {status && <p className="admin-status-bar">{status}</p>}
            </td>
          </tr>
          {/* Row 2: folder form (above Name/Security/Size) + action buttons (above Modified/Delete) */}
          <tr className="admin-util-row admin-util-row-sep-below">
            <td colSpan={colLeft} className="admin-util-cell">
              {!readonly && showNewFolderWhere === 'top' && (
                <form className="admin-folder-form" onSubmit={handleCreateFolder}>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    className="admin-input admin-input-sm"
                    autoFocus
                  />
                  <button type="submit" className="admin-btn admin-btn-primary">Create</button>
                  <button type="button" className="admin-btn" onClick={() => setShowNewFolderWhere(null)}>Cancel</button>
                </form>
              )}
            </td>
            <td colSpan={colRight} className="admin-util-cell">
              {readonly
                ? <div className="admin-util-actions"><span className="admin-readonly-badge">Read-only</span></div>
                : (
                  <div className="admin-util-actions">
                    <button className="admin-btn" onClick={toggleNewFolderTop}>New folder</button>
                    <label className="admin-btn" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                      {uploading ? 'Uploading…' : 'Upload files'}
                      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
                    </label>
                  </div>
                )
              }
            </td>
          </tr>
          {/* Column headers */}
          <tr>
            <th>Name</th>
            <th className="admin-th-sec">Security</th>
            <th>Size</th>
            <th>Modified</th>
            {!readonly && <th></th>}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={colTotal} className="admin-loading">Loading…</td></tr>
          )}
          {!loading && listing && (
            <>
              {listing.currentSecurity && (
                <tr className="admin-row-current-dir">
                  <td>
                    <span className="admin-entry-name admin-cur-dir-label">
                      {currentPath ? `📁 ${currentPath.split('/').pop()}/` : '📁 /'}
                    </span>
                  </td>
                  <td className="admin-cell-sec"><SecurityIcons sec={listing.currentSecurity} /></td>
                  <td className="admin-cell-meta" colSpan={2} />
                  {!readonly && <td />}
                </tr>
              )}
              {totalItems === 0 && (
                <tr><td colSpan={colTotal} className="admin-empty">Empty folder</td></tr>
              )}
              {listing.dirs.map(d => (
                <tr key={`d:${d.name}`} className="admin-row-dir">
                  <td>
                    <button className="admin-entry-name admin-dir-link" onClick={() => navigate(currentPath ? `${currentPath}/${d.name}` : d.name)}>
                      📁 <span className="admin-entry-text">{d.name}</span>
                    </button>
                  </td>
                  <td className="admin-cell-sec"><SecurityIcons sec={d.security} /></td>
                  <td className="admin-cell-meta">{formatSize(d.size)}</td>
                  <td className="admin-cell-meta">{formatDate(d.lastModified)}</td>
                  {!readonly && (
                    <td><button className="admin-btn admin-btn-danger admin-btn-table" onClick={() => handleDeleteDir(d.name)}>Delete</button></td>
                  )}
                </tr>
              ))}
              {listing.files.map(f => {
                const isProtected = !currentPath && f.name === 'content-security.json'
                return (
                  <tr key={`f:${f.name}`}>
                    <td>{f.name === 'content-security.json'
                      ? <span className="admin-entry-name">📄 <span className="admin-entry-text">{f.name}</span></span>
                      : <span className="admin-entry-name">📄 <a className="admin-file-link" href={buildFileHref(currentPath, f.name)} target="_blank" rel="noreferrer"><span className="admin-entry-text">{f.name}</span></a></span>
                    }</td>
                    <td className="admin-cell-sec"><SecurityIcons sec={f.security} /></td>
                    <td className="admin-cell-meta">{formatSize(f.size)}</td>
                    <td className="admin-cell-meta">{formatDate(f.lastModified)}</td>
                    {!readonly && (
                      <td>{isProtected
                        ? <span className="admin-protected-label" title="Deleting this file would disable admin auth and all access rules.">🔒</span>
                        : <button className="admin-btn admin-btn-danger admin-btn-table" onClick={() => handleDeleteFile(f.name)}>Delete</button>
                      }</td>
                    )}
                  </tr>
                )
              })}
            </>
          )}
        </tbody>
        {showBottomActions && (
          <tfoot>
            <tr className="admin-util-row admin-util-row-sep">
              <td colSpan={colLeft} className="admin-util-cell">
                {showNewFolderWhere === 'bottom' && (
                  <form className="admin-folder-form" onSubmit={handleCreateFolder}>
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      placeholder="Folder name"
                      className="admin-input admin-input-sm"
                      autoFocus
                    />
                    <button type="submit" className="admin-btn admin-btn-primary">Create</button>
                    <button type="button" className="admin-btn" onClick={() => setShowNewFolderWhere(null)}>Cancel</button>
                  </form>
                )}
              </td>
              <td colSpan={colRight} className="admin-util-cell">
                <div className="admin-util-actions">
                  <button className="admin-btn" onClick={toggleNewFolderBottom}>New folder</button>
                  <button className="admin-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? 'Uploading…' : 'Upload files'}
                  </button>
                </div>
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {confirmDir && (
        <DeleteFolderModal
          info={confirmDir}
          typedName={confirmName}
          onTypedNameChange={setConfirmName}
          onCancel={() => { setConfirmDir(null); setConfirmName('') }}
          onConfirm={confirmRecursiveDelete}
          busy={deleting}
        />
      )}
    </div>
  )
}

// ── Folder delete confirmation modal ─────────────────────────────────────────

const DELETE_TYPED_NAME_THRESHOLD_ITEMS = 50
const DELETE_TYPED_NAME_THRESHOLD_BYTES = 50 * 1024 * 1024 // 50 MB

function DeleteFolderModal({ info, typedName, onTypedNameChange, onCancel, onConfirm, busy }) {
  const requiresTyped =
    info.count >= DELETE_TYPED_NAME_THRESHOLD_ITEMS ||
    info.size  >= DELETE_TYPED_NAME_THRESHOLD_BYTES
  const canConfirm = !busy && (!requiresTyped || typedName === info.name)

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div className="admin-modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="admin-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3 className="admin-modal-title">Delete folder “{info.name}”?</h3>
        <div className="admin-modal-body">
          <p>
            This folder contains <strong>{info.count}</strong> item{info.count === 1 ? '' : 's'} totaling <strong>{formatSize(info.size)}</strong>.
            Recursive deletion is permanent and cannot be undone.
          </p>
          {requiresTyped && (
            <p>
              Type the folder name <code>{info.name}</code> to confirm:
              <input
                type="text"
                className="admin-input admin-modal-input"
                value={typedName}
                onChange={e => onTypedNameChange(e.target.value)}
                disabled={busy}
                autoFocus
              />
            </p>
          )}
        </div>
        <div className="admin-modal-actions">
          <button className="admin-btn" onClick={onCancel} disabled={busy} autoFocus={!requiresTyped}>Cancel</button>
          <button className="admin-btn admin-btn-danger" onClick={onConfirm} disabled={!canConfirm}>
            {busy ? 'Deleting…' : `Delete ${info.count} item${info.count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Root shell ───────────────────────────────────────────────────────────────

export default function AdminShell({ cookieConfig }) {
  const [authed, setAuthed]     = useState(null)
  const [readonly, setReadonly] = useState(false)

  useEffect(() => {
    // Check sessionStorage first, then cookie
    let token = getToken()
    if (!token && cookieConfig) {
      token = readCookie(adminCookieName(cookieConfig.prefix)) || ''
      if (token) setToken(token)
    }
    if (!token) { setAuthed(false); return }
    fetch('/api/admin/config', { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) { clearToken(cookieConfig); setAuthed(false); return }
        return r.json().then(d => { setStoredReadonly(d.readonly); setReadonly(d.readonly); setAuthed(true) })
      })
      .catch(() => { setReadonly(getStoredReadonly()); setAuthed(true) })
  }, [])

  function handleLogin(token, ro) {
    setToken(token)
    setStoredReadonly(ro)
    if (cookieConfig) writeCookie(adminCookieName(cookieConfig.prefix), token, cookieConfig)
    setReadonly(ro)
    setAuthed(true)
  }

  function handleLogout() {
    clearToken(cookieConfig)
    setAuthed(false)
  }

  if (authed === null) return null
  if (!authed) return <LoginForm onLogin={handleLogin} />
  return <FileBrowser onLogout={handleLogout} readonly={readonly} cookieConfig={cookieConfig} />
}
