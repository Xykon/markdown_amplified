'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

const TOKEN_KEY = 'admin-token'
const READONLY_KEY = 'admin-readonly'

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}
function setToken(t) {
  try { sessionStorage.setItem(TOKEN_KEY, t) } catch { }
}
function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(READONLY_KEY) } catch { }
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

// ── Login form ──────────────────────────────────────────────────────────────

function LoginForm({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      setToken(data.token)
      setStoredReadonly(data.readonly)
      onLogin(data.readonly)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login">
      <h1 className="admin-login-title">Admin</h1>
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

function FileBrowser({ onLogout, readonly }) {
  const [currentPath, setCurrentPath] = useState('')
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const load = useCallback(async (path) => {
    setLoading(true)
    setError('')
    setStatus('')
    try {
      const res = await fetch(`/api/admin/files?path=${encodeURIComponent(path)}`, {
        headers: authHeaders(),
      })
      if (res.status === 401) { clearToken(); onLogout(); return }
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
    load(path)
  }

  async function handleDelete(name, isDir) {
    const fullPath = currentPath ? `${currentPath}/${name}` : name
    if (!confirm(`Delete "${fullPath}"?`)) return
    setStatus('')
    setError('')
    try {
      const res = await fetch(`/api/admin/files/${encodeURIComponent(fullPath).replace(/%2F/g, '/')}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (res.status === 401) { clearToken(); onLogout(); return }
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Delete failed'); return }
      setStatus(`Deleted "${name}"`)
      load(currentPath)
    } catch {
      setError('Network error')
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
        if (res.status === 401) { clearToken(); onLogout(); return }
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
      if (res.status === 401) { clearToken(); onLogout(); return }
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Create folder failed'); return }
      setStatus(`Created folder "${name}"`)
      setNewFolderName('')
      setShowNewFolder(false)
      load(currentPath)
    } catch {
      setError('Network error')
    }
  }

  return (
    <div className="admin-shell">
      <div className="admin-toolbar">
        <Breadcrumb path={currentPath} onNavigate={navigate} />
        <div className="admin-toolbar-actions">
          {readonly && <span className="admin-readonly-badge">Read-only</span>}
          {!readonly && (
            <button className="admin-btn admin-btn-sm" onClick={() => { setShowNewFolder(v => !v); setNewFolderName('') }}>
              New folder
            </button>
          )}
          {!readonly && (
            <label className="admin-btn admin-btn-sm admin-btn-primary" style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
              {uploading ? 'Uploading…' : 'Upload files'}
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
            </label>
          )}
          <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => { clearToken(); onLogout() }}>
            Sign out
          </button>
        </div>
      </div>

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
          <button type="submit" className="admin-btn admin-btn-sm admin-btn-primary">Create</button>
          <button type="button" className="admin-btn admin-btn-sm" onClick={() => setShowNewFolder(false)}>Cancel</button>
        </form>
      )}

      {error && <p className="admin-error admin-error-bar">{error}</p>}
      {status && <p className="admin-status-bar">{status}</p>}

      {loading && <p className="admin-loading">Loading…</p>}

      {!loading && listing && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listing.dirs.length === 0 && listing.files.length === 0 && (
              <tr><td colSpan={4} className="admin-empty">Empty folder</td></tr>
            )}
            {listing.dirs.map(d => (
              <tr key={`d:${d.name}`} className="admin-row-dir">
                <td>
                  <button className="admin-entry-name admin-dir-link" onClick={() => navigate(currentPath ? `${currentPath}/${d.name}` : d.name)}>
                    📁 {d.name}
                  </button>
                </td>
                <td></td>
                <td></td>
                <td>
                  {!readonly && <button className="admin-btn admin-btn-xs admin-btn-danger" onClick={() => handleDelete(d.name, true)}>Delete</button>}
                </td>
              </tr>
            ))}
            {listing.files.map(f => (
              <tr key={`f:${f.name}`}>
                <td><span className="admin-entry-name">📄 {f.name}</span></td>
                <td className="admin-cell-meta">{formatSize(f.size)}</td>
                <td className="admin-cell-meta">{formatDate(f.lastModified)}</td>
                <td>
                  {!readonly && <button className="admin-btn admin-btn-xs admin-btn-danger" onClick={() => handleDelete(f.name, false)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Root shell ───────────────────────────────────────────────────────────────

export default function AdminShell() {
  const [authed, setAuthed] = useState(null)
  const [readonly, setReadonly] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) { setAuthed(false); return }
    // Refresh config from server to pick up any readonly change since last login
    fetch('/api/admin/config', { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) { clearToken(); setAuthed(false); return }
        return r.json().then(d => { setStoredReadonly(d.readonly); setReadonly(d.readonly); setAuthed(true) })
      })
      .catch(() => { setReadonly(getStoredReadonly()); setAuthed(true) })
  }, [])

  if (authed === null) return null

  if (!authed) return <LoginForm onLogin={(ro) => { setReadonly(ro); setAuthed(true) }} />

  return <FileBrowser onLogout={() => setAuthed(false)} readonly={readonly} />
}
