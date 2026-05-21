'use client'

import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from './adminApi'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return null
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) }
  catch { return iso }
}

function isNowActive(from, until) {
  const now = new Date()
  if (from && now < new Date(from)) return false
  if (until && now > new Date(until)) return false
  return true
}

function ruleToForm(rule = {}) {
  let home = '', homeCustom = ''
  if (rule.home !== undefined) {
    if (rule.home === 'site') home = 'site'
    else if (rule.home === 'folder') home = 'folder'
    else if (rule.home === false) home = 'false'
    else if (typeof rule.home === 'string') { home = '_custom'; homeCustom = rule.home }
  }
  return {
    match: rule.match || '',
    password: '',
    removePassword: false,
    validFrom: rule.validFrom || '',
    validUntil: rule.validUntil || '',
    download: rule.download === true ? 'true' : rule.download === false ? 'false' : '',
    home, homeCustom,
    toc: rule.toc === true ? 'true' : rule.toc === false ? 'false' : '',
    name: rule.name || '',
    banner: rule.banner || '',
    bannerLight: rule.bannerLight || '',
    bannerDark: rule.bannerDark || '',
  }
}

function formToRule(form, existingRule = {}) {
  const rule = { match: form.match }
  if (form.removePassword) { /* no password */ }
  else if (form.password) rule.password = form.password
  else if (existingRule.password) rule.password = existingRule.password
  if (form.validFrom) rule.validFrom = form.validFrom
  if (form.validUntil) rule.validUntil = form.validUntil
  if (form.download === 'true') rule.download = true
  else if (form.download === 'false') rule.download = false
  if (form.home === 'site') rule.home = 'site'
  else if (form.home === 'folder') rule.home = 'folder'
  else if (form.home === 'false') rule.home = false
  else if (form.home === '_custom' && form.homeCustom) rule.home = form.homeCustom
  if (form.toc === 'true') rule.toc = true
  else if (form.toc === 'false') rule.toc = false
  if (form.name) rule.name = form.name
  if (form.banner) rule.banner = form.banner
  if (form.bannerLight) rule.bannerLight = form.bannerLight
  if (form.bannerDark) rule.bannerDark = form.bannerDark
  return rule
}

// ── Inline edit form ──────────────────────────────────────────────────────────

function RuleEditForm({ rule, onSave, onCancel, disabled }) {
  const [form, setForm] = useState(() => ruleToForm(rule))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.match.trim()) return
    onSave(formToRule(form, rule))
  }

  return (
    <form onSubmit={handleSubmit} className="admin-sec-edit-form">
      <div className="admin-sec-edit-fields">
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Match</label>
          <input className="admin-input admin-input-sm" value={form.match} onChange={e => set('match', e.target.value)} disabled={disabled} required placeholder="folder/ or file.md" />
          <p className="admin-field-help">Folder rules end with /. File rules match exactly.</p>
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Password</label>
          {!form.removePassword && (
            <input className="admin-input admin-input-sm" type="password" value={form.password} onChange={e => set('password', e.target.value)} disabled={disabled} autoComplete="new-password" placeholder={rule.password ? 'New password to change' : 'Leave blank for none'} />
          )}
          {rule.password && (
            <label className="admin-checkbox-label" style={{ marginLeft: 24 }}>
              <input type="checkbox" checked={form.removePassword} onChange={e => set('removePassword', e.target.checked)} disabled={disabled} />
              Remove password
            </label>
          )}
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Date range</label>
          <div className="admin-sec-date-row">
            <div>
              <label className="admin-field-label-sm">From</label>
              <input className="admin-input admin-input-sm" type="date" value={form.validFrom} onChange={e => set('validFrom', e.target.value)} disabled={disabled} />
            </div>
            <div>
              <label className="admin-field-label-sm">Until</label>
              <input className="admin-input admin-input-sm" type="date" value={form.validUntil} onChange={e => set('validUntil', e.target.value)} disabled={disabled} />
            </div>
          </div>
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Download</label>
          <select className="admin-input admin-input-sm" value={form.download} onChange={e => set('download', e.target.value)} disabled={disabled}>
            <option value="">Default (blocked if password-protected)</option>
            <option value="true">Always allowed</option>
            <option value="false">Always blocked</option>
          </select>
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Home button</label>
          <select className="admin-input admin-input-sm" value={form.home} onChange={e => set('home', e.target.value)} disabled={disabled}>
            <option value="">Default</option>
            <option value="site">Site root (/)</option>
            <option value="folder">Folder root</option>
            <option value="false">Disabled</option>
            <option value="_custom">Custom URL</option>
          </select>
          {form.home === '_custom' && (
            <input className="admin-input admin-input-sm" style={{ marginTop: 6 }} value={form.homeCustom} onChange={e => set('homeCustom', e.target.value)} disabled={disabled} placeholder="https://..." />
          )}
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Table of contents</label>
          <select className="admin-input admin-input-sm" value={form.toc} onChange={e => set('toc', e.target.value)} disabled={disabled}>
            <option value="">Default (open)</option>
            <option value="true">Open</option>
            <option value="false">Closed</option>
          </select>
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Custom name</label>
          <input className="admin-input admin-input-sm" value={form.name} onChange={e => set('name', e.target.value)} disabled={disabled} placeholder="Section name" />
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Banner</label>
          <input className="admin-input admin-input-sm" value={form.banner} onChange={e => set('banner', e.target.value)} disabled={disabled} placeholder="banner.svg" />
          <div className="admin-sec-date-row" style={{ marginTop: 6 }}>
            <input className="admin-input admin-input-sm" value={form.bannerLight} onChange={e => set('bannerLight', e.target.value)} disabled={disabled} placeholder="Light mode" />
            <input className="admin-input admin-input-sm" value={form.bannerDark} onChange={e => set('bannerDark', e.target.value)} disabled={disabled} placeholder="Dark mode" />
          </div>
        </div>
      </div>
      <div className="admin-sec-form-actions">
        <button type="button" className="admin-btn" onClick={onCancel}>Cancel</button>
        {!disabled && <button type="submit" className="admin-btn admin-btn-primary">Save rule</button>}
      </div>
    </form>
  )
}

// ── Add rule form ─────────────────────────────────────────────────────────────

function AddRuleForm({ onAdd, onCancel, onLogout }) {
  const [folders, setFolders]           = useState(null)  // null = loading
  const [files, setFiles]               = useState([])
  const [folderChoice, setFolderChoice] = useState('')    // '' = root, path = subfolder, '_custom' = manual
  const [folderCustom, setFolderCustom] = useState('')
  const [fileChoice, setFileChoice]     = useState('')    // '' = none (root), '_folder' = folder-wide, filename, '_custom'
  const [fileCustom, setFileCustom]     = useState('')
  const [form, setForm]                 = useState(() => ruleToForm({}))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // BFS fetch of all sub-folders on mount, max depth 4
  useEffect(() => {
    let cancelled = false
    async function loadFolders() {
      const result = []
      const queue = [{ path: '', depth: 0 }]
      while (queue.length > 0) {
        const { path, depth } = queue.shift()
        if (depth > 4) continue
        try {
          const res = await fetch(`/api/admin/files?path=${encodeURIComponent(path)}`, { headers: authHeaders() })
          if (res.status === 401) { onLogout(); return }
          if (!res.ok) continue
          const data = await res.json()
          for (const dir of (data.dirs || [])) {
            const full = path ? `${path}/${dir.name}` : dir.name
            result.push(full)
            queue.push({ path: full, depth: depth + 1 })
          }
        } catch { break }
      }
      if (!cancelled) setFolders(result)
    }
    loadFolders()
    return () => { cancelled = true }
  }, [onLogout])

  // Fetch files for the selected folder when it changes
  useEffect(() => {
    if (folderChoice === '_custom') { setFiles([]); return }
    setFiles([])
    fetch(`/api/admin/files?path=${encodeURIComponent(folderChoice)}`, { headers: authHeaders() })
      .then(r => { if (r.status === 401) { onLogout(); return null } return r.json() })
      .then(data => {
        if (data) setFiles((data.files || [])
          .map(f => f.name)
          .filter(n => !(folderChoice === '' && n === 'content-security.json')))
      })
      .catch(() => {})
  }, [folderChoice, onLogout])

  const effectiveFolder = folderChoice === '_custom' ? folderCustom.trim() : folderChoice
  const isRoot = !effectiveFolder

  // Compute match string
  let match = ''
  if (fileChoice === '_folder') {
    match = effectiveFolder ? effectiveFolder + '/' : ''
  } else if (fileChoice === '_custom') {
    match = effectiveFolder
      ? (fileCustom.trim() ? effectiveFolder + '/' + fileCustom.trim() : '')
      : fileCustom.trim()
  } else if (fileChoice) {
    match = effectiveFolder ? effectiveFolder + '/' + fileChoice : fileChoice
  }

  function handleFolderChange(val) {
    setFolderChoice(val)
    setFolderCustom('')
    setFileChoice(val === '' ? '' : '_folder')
    setFileCustom('')
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!match.trim()) return
    onAdd(formToRule({ ...form, match }, {}))
  }

  return (
    <form onSubmit={handleSubmit} className="admin-sec-edit-form">
      <h4 className="admin-sec-add-title">New rule</h4>
      <div className="admin-sec-edit-fields">
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Folder</label>
          <select className="admin-input admin-input-sm" value={folderChoice} onChange={e => handleFolderChange(e.target.value)} disabled={folders === null}>
            <option value="">— root folder —</option>
            {(folders || []).map(f => <option key={f} value={f}>{f}/</option>)}
            <option value="_custom">Type manually…</option>
          </select>
          {folderChoice === '_custom' && (
            <input className="admin-input admin-input-sm" value={folderCustom} onChange={e => setFolderCustom(e.target.value)} placeholder="path/to/folder" autoFocus />
          )}
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">File</label>
          <select className="admin-input admin-input-sm" value={fileChoice} onChange={e => { setFileChoice(e.target.value); setFileCustom('') }} disabled={folderChoice === '_custom' && !effectiveFolder}>
            {isRoot
              ? <option value="">— pick a file —</option>
              : <option value="_folder">— folder wide —</option>
            }
            {files.map(f => <option key={f} value={f}>{f}</option>)}
            <option value="_custom">Type manually…</option>
          </select>
          {fileChoice === '_custom' && (
            <input className="admin-input admin-input-sm" value={fileCustom} onChange={e => setFileCustom(e.target.value)} placeholder={effectiveFolder ? 'filename.md' : 'path/to/file.md'} />
          )}
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Password</label>
          <input className="admin-input admin-input-sm" type="password" value={form.password} onChange={e => set('password', e.target.value)} autoComplete="new-password" placeholder="Leave blank for no password" />
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Date range</label>
          <div className="admin-sec-date-row">
            <div>
              <label className="admin-field-label-sm">From</label>
              <input className="admin-input admin-input-sm" type="date" value={form.validFrom} onChange={e => set('validFrom', e.target.value)} />
            </div>
            <div>
              <label className="admin-field-label-sm">Until</label>
              <input className="admin-input admin-input-sm" type="date" value={form.validUntil} onChange={e => set('validUntil', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="admin-sec-edit-group">
          <label className="admin-field-label">Download</label>
          <select className="admin-input admin-input-sm" value={form.download} onChange={e => set('download', e.target.value)}>
            <option value="">Default</option>
            <option value="true">Always allowed</option>
            <option value="false">Always blocked</option>
          </select>
        </div>
      </div>
      {match && <code className="admin-sec-match-preview">match: {match}</code>}
      <div className="admin-sec-form-actions">
        <button type="button" className="admin-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="admin-btn admin-btn-primary" disabled={!match.trim()}>Add rule</button>
      </div>
    </form>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminSecurity({ readonly, onLogout }) {
  const [config, setConfig] = useState(null)
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/security', { headers: authHeaders() })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setConfig(data)
      setRules(Array.isArray(data.rules) ? data.rules : [])
    } catch {
      setError('Failed to load security rules')
    } finally {
      setLoading(false)
    }
  }, [onLogout])

  useEffect(() => { load() }, [load])

  async function saveRules(newRules) {
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const updated = { ...config, rules: newRules }
      const res = await fetch('/api/admin/security', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updated),
      })
      if (res.status === 401) { onLogout(); return false }
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Save failed'); return false }
      setConfig(updated)
      setRules(newRules)
      return true
    } catch {
      setError('Network error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteRule(idx) {
    const match = rules[idx].match
    if (!confirm(`Delete rule for "${match}"?`)) return
    const ok = await saveRules(rules.filter((_, i) => i !== idx))
    if (ok) { setStatus(`Deleted rule "${match}"`); setExpandedIdx(null) }
  }

  async function handleSaveRule(idx, updated) {
    const ok = await saveRules(rules.map((r, i) => i === idx ? updated : r))
    if (ok) { setStatus('Rule saved'); setExpandedIdx(null) }
  }

  async function handleAddRule(newRule) {
    const ok = await saveRules([...rules, newRule])
    if (ok) { setStatus(`Added rule "${newRule.match}"`); setShowAddForm(false) }
  }

  function toggleExpanded(idx) {
    setExpandedIdx(v => v === idx ? null : idx)
    setShowAddForm(false)
  }

  function toggleAddForm() {
    setShowAddForm(v => !v)
    setExpandedIdx(null)
  }

  const colCount = readonly ? 4 : 5

  if (loading) return <p className="admin-loading">Loading…</p>

  return (
    <div>
      {error && <p className="admin-error-bar" style={{ marginBottom: 12 }}>{error}</p>}
      {status && <p className="admin-status-bar" style={{ marginBottom: 12 }}>{status}</p>}
      <table className="admin-table">
        <thead>
          <tr className="admin-util-row admin-util-row-sep-below">
            <td colSpan={colCount} className="admin-util-cell">
              <div className="admin-util-topbar">
                <span className="admin-sec-subtitle">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
                {!readonly && (
                  <button className="admin-btn" onClick={toggleAddForm}>
                    {showAddForm ? 'Cancel' : 'New rule'}
                  </button>
                )}
              </div>
            </td>
          </tr>
          <tr>
            <th>Match</th>
            <th>Password</th>
            <th>Dates</th>
            <th>DL</th>
            {!readonly && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 && (
            <tr><td colSpan={colCount} className="admin-empty">No security rules defined.</td></tr>
          )}
          {rules.flatMap((rule, idx) => {
            const hasDate = rule.validFrom || rule.validUntil
            const dateActive = hasDate ? isNowActive(rule.validFrom, rule.validUntil) : null
            const dateStr = [
              rule.validFrom ? fmtDate(rule.validFrom) : null,
              rule.validUntil ? fmtDate(rule.validUntil) : null,
            ].filter(Boolean).join(' – ')
            const isExpanded = expandedIdx === idx

            return [
              <tr key={idx} className={isExpanded ? 'admin-sec-row-expanded' : ''}>
                <td>
                  <button className="admin-sec-match-btn" onClick={() => toggleExpanded(idx)}>
                    <span className="admin-sec-caret">{isExpanded ? '▾' : '▸'}</span>
                    <code className="admin-sec-match">{rule.match}</code>
                  </button>
                </td>
                <td className="admin-cell-meta">{rule.password ? '●' : '—'}</td>
                <td className="admin-cell-meta">
                  {dateStr
                    ? <span className={dateActive ? 'sec-icon sec-green' : 'sec-icon sec-red'} style={{ fontSize: '0.8em' }} title={dateActive ? 'Currently active' : 'Currently inactive'}>{dateStr}</span>
                    : '—'
                  }
                </td>
                <td className="admin-cell-meta">
                  {rule.download === true ? <span className="sec-icon sec-green">✓</span>
                    : rule.download === false ? <span className="sec-icon sec-red">✗</span>
                    : '—'}
                </td>
                {!readonly && (
                  <td>
                    <button className="admin-btn admin-btn-table" onClick={() => toggleExpanded(idx)}>
                      {isExpanded ? 'Close' : 'Edit'}
                    </button>
                    {' '}
                    <button className="admin-btn admin-btn-danger admin-btn-table" onClick={() => handleDeleteRule(idx)} disabled={saving}>Delete</button>
                  </td>
                )}
              </tr>,
              isExpanded && (
                <tr key={`edit-${idx}`} className="admin-sec-edit-row">
                  <td colSpan={colCount} className="admin-sec-edit-cell">
                    <RuleEditForm rule={rule} onSave={updated => handleSaveRule(idx, updated)} onCancel={() => setExpandedIdx(null)} disabled={readonly || saving} />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
        {showAddForm && (
          <tfoot>
            <tr>
              <td colSpan={colCount} className="admin-sec-edit-cell" style={{ borderTop: '2px solid var(--border)' }}>
                <AddRuleForm onAdd={handleAddRule} onCancel={() => setShowAddForm(false)} onLogout={onLogout} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
