'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { adminCookieName, readCookie, writeCookie, deleteCookie } from '../pw-cookie'

const TOKEN_KEY = 'admin-token'
const READONLY_KEY = 'admin-readonly'
const ACTIONS_REPEAT_THRESHOLD = 8  // show action bar below table too when this many items

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
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [showNewFolderBottom, setShowNewFolderBottom] = useState(false)
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
    setShowNewFolder(false)
    setShowNewFolderBottom(false)
    load(path)
  }

  function toggleNewFolder() {
    setShowNewFolder(v => !v)
    setShowNewFolderBottom(false)
    setNewFolderName('')
  }

  function toggleNewFolderBottom() {
    setShowNewFolderBottom(v => !v)
    setShowNewFolder(false)
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
      setShowNewFolder(false)
      setShowNewFolderBottom(false)
      load(currentPath)
    } catch {
      setError('Network error')
    }
  }

  const totalItems = (listing?.dirs.length ?? 0) + (listing?.files.length ?? 0)
  const showBottomActions = !readonly && totalItems >= ACTIONS_REPEAT_THRESHOLD

  return (
    <div>
      {/* Top bar: breadcrumb + sign out */}
      <div className="admin-topbar">
        <Breadcrumb path={currentPath} onNavigate={navigate} />
        <div className="admin-topbar-right">
          {readonly && <span className="admin-readonly-badge">Read-only</span>}
          <button className="admin-btn admin-btn-danger" onClick={() => { clearToken(cookieConfig); onLogout() }}>
            Sign out
          </button>
        </div>
      </div>

      {/* New folder inline form */}
      {!readonly && showNewFolder && (
        <form className="admin-new-folder-row" onSubmit={handleCreateFolder}>
          <input
            type="text"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="admin-input admin-input-sm"
            autoFocus
          />
          <button type="submit" className="admin-btn admin-btn-primary">Create</button>
          <button type="button" className="admin-btn" onClick={() => setShowNewFolder(false)}>Cancel</button>
        </form>
      )}

      {error && <p className="admin-error admin-error-bar">{error}</p>}
      {status && <p className="admin-status-bar">{status}</p>}

      {loading && <p className="admin-loading">Loading…</p>}

      {!loading && listing && (
        <table className="admin-table">
          <thead>
            {!readonly && (
              <tr className="admin-action-row">
                <td colSpan={2} />
                <td colSpan={2} className="admin-action-cell">
                  <div className="admin-actions-inline">
                    <button className="admin-btn" onClick={toggleNewFolder}>New folder</button>
                    <label className="admin-btn" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
                      {uploading ? 'Uploading…' : 'Upload files'}
                      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
                    </label>
                  </div>
                </td>
              </tr>
            )}
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              {!readonly && <th></th>}
            </tr>
          </thead>
          <tbody>
            {totalItems === 0 && (
              <tr><td colSpan={readonly ? 3 : 4} className="admin-empty">Empty folder</td></tr>
            )}
            {listing.dirs.map(d => (
              <tr key={`d:${d.name}`} className="admin-row-dir">
                <td>
                  <button className="admin-entry-name admin-dir-link" onClick={() => navigate(currentPath ? `${currentPath}/${d.name}` : d.name)}>
                    📁 <span className="admin-entry-text">{d.name}</span>
                  </button>
                </td>
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
          </tbody>
          {showBottomActions && (
            <tfoot>
              <tr className="admin-action-row">
                <td colSpan={2} />
                <td colSpan={2} className="admin-action-cell">
                  <div className="admin-actions-inline">
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
      )}

      {!readonly && showNewFolderBottom && (
        <form className="admin-new-folder-row" onSubmit={handleCreateFolder}>
          <input
            type="text"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="admin-input admin-input-sm"
            autoFocus
          />
          <button type="submit" className="admin-btn admin-btn-primary">Create</button>
          <button type="button" className="admin-btn" onClick={() => setShowNewFolderBottom(false)}>Cancel</button>
        </form>
      )}

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
