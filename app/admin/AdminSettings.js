'use client'

import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from './adminApi'

// ── Form state helpers ────────────────────────────────────────────────────────

function configToForm(config) {
  const b = config.siteButton || {}
  const a = config.admin || {}
  const c = config.cookies || {}

  let home = 'site', homeCustom = ''
  if (config.home === 'folder') home = 'folder'
  else if (config.home === false) home = 'false'
  else if (typeof config.home === 'string' && config.home !== 'site') { home = '_custom'; homeCustom = config.home }

  return {
    name: config.name || '',
    banner: config.banner || '',
    bannerLight: config.bannerLight || '',
    bannerDark: config.bannerDark || '',
    sbEnabled: !!(b.icon || b.iconLight || b.iconDark),
    sbIcon: b.icon || '',
    sbIconLight: b.iconLight || '',
    sbIconDark: b.iconDark || '',
    sbUrl: b.url || '',
    sbPlacement: b.placement || 'right',
    sbAlignment: b.alignment || 'right',
    sbAlt: b.alt || '',
    home,
    homeCustom,
    toc: config.toc !== false,
    adminEnabled: a.enabled !== false,
    adminReadonly: a.readonly === true,
    adminPassword: '',
    adminPasswordConfirm: '',
    cookiesEnabled: c.enabled === true,
    cookiesPrefix: c.prefix || 'md',
    cookiesMaxAge: typeof c.maxAge === 'number' ? String(c.maxAge) : '2592000',
    cookiesDomain: c.domain || '',
    cookiesStoreAdmin: c.storeAdmin === true,
  }
}

function formToConfig(form, existing, sensitiveEditable) {
  const result = { ...existing }

  if (form.name) result.name = form.name; else delete result.name
  if (form.banner) result.banner = form.banner; else delete result.banner
  if (form.bannerLight) result.bannerLight = form.bannerLight; else delete result.bannerLight
  if (form.bannerDark) result.bannerDark = form.bannerDark; else delete result.bannerDark

  if (form.sbEnabled && (form.sbIcon || form.sbIconLight || form.sbIconDark)) {
    const sb = {}
    if (form.sbIcon) sb.icon = form.sbIcon
    if (form.sbIconLight) sb.iconLight = form.sbIconLight
    if (form.sbIconDark) sb.iconDark = form.sbIconDark
    if (form.sbUrl) sb.url = form.sbUrl
    sb.placement = form.sbPlacement
    sb.alignment = form.sbAlignment
    if (form.sbAlt) sb.alt = form.sbAlt
    result.siteButton = sb
  } else {
    delete result.siteButton
  }

  if (form.home === 'site') delete result.home
  else if (form.home === 'folder') result.home = 'folder'
  else if (form.home === 'false') result.home = false
  else if (form.home === '_custom') result.home = form.homeCustom || 'site'

  if (form.toc) delete result.toc
  else result.toc = false

  if (sensitiveEditable) {
    result.admin = {
      ...result.admin,
      enabled: form.adminEnabled,
      readonly: form.adminReadonly,
    }
    if (form.adminPassword && form.adminPassword === form.adminPasswordConfirm) {
      result.admin.password = form.adminPassword
    }

    if (form.cookiesEnabled) {
      result.cookies = {
        enabled: true,
        prefix: form.cookiesPrefix || 'md',
        maxAge: parseInt(form.cookiesMaxAge, 10) || 2592000,
        storeAdmin: form.cookiesStoreAdmin,
      }
      if (form.cookiesDomain) result.cookies.domain = form.cookiesDomain
    } else {
      if (result.cookies) result.cookies = { ...result.cookies, enabled: false }
      else delete result.cookies
    }
  }

  return result
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, help, children }) {
  return (
    <div className="admin-field">
      <label className="admin-field-label">{label}</label>
      {children}
      {help && <p className="admin-field-help">{help}</p>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="admin-settings-section">
      <h3 className="admin-settings-section-title">{title}</h3>
      <div className="admin-settings-fields">{children}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminSettings({ readonly, onLogout }) {
  const [config, setConfig] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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
      setForm(configToForm(data))
    } catch {
      setError('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [onLogout])

  useEffect(() => { load() }, [load])

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setStatus('')
  }

  async function handleSave(e) {
    e.preventDefault()
    if (form.adminPassword && form.adminPassword !== form.adminPasswordConfirm) {
      setError('Passwords do not match')
      return
    }
    setSaving(true)
    setError('')
    setStatus('')
    try {
      const sensitiveEditable = config?.admin?.allowSensitiveEdits === true && !readonly
      const updated = formToConfig(form, config, sensitiveEditable)
      const res = await fetch('/api/admin/security', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updated),
      })
      if (res.status === 401) { onLogout(); return }
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Save failed'); return }
      setConfig(updated)
      setForm(configToForm(updated))
      setStatus('Settings saved')
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="admin-loading">Loading…</p>
  if (!form) return null

  const sensitiveEditable = config?.admin?.allowSensitiveEdits === true && !readonly
  const disabled = readonly

  return (
    <form onSubmit={handleSave} className="admin-settings-form">
      {error && <p className="admin-error-bar" style={{ marginBottom: 16 }}>{error}</p>}
      {status && <p className="admin-status-bar" style={{ marginBottom: 16 }}>{status}</p>}

      <Section title="Header">
        <Field label="Site name" help="Shown in the header. Falls back to 'Markdown Amplified' if empty.">
          <input className="admin-input" value={form.name} onChange={e => set('name', e.target.value)} disabled={disabled} placeholder="My Site" />
        </Field>
        <div className="admin-settings-row">
          <Field label="Banner">
            <input className="admin-input" value={form.banner} onChange={e => set('banner', e.target.value)} disabled={disabled} placeholder="banner.svg" />
          </Field>
          <Field label="Banner — light mode">
            <input className="admin-input" value={form.bannerLight} onChange={e => set('bannerLight', e.target.value)} disabled={disabled} placeholder="banner-light.svg" />
          </Field>
          <Field label="Banner — dark mode">
            <input className="admin-input" value={form.bannerDark} onChange={e => set('bannerDark', e.target.value)} disabled={disabled} placeholder="banner-dark.svg" />
          </Field>
        </div>
      </Section>

      <Section title="Site button">
        <div className="admin-field">
          <label className="admin-checkbox-label">
            <input type="checkbox" checked={form.sbEnabled} onChange={e => set('sbEnabled', e.target.checked)} disabled={disabled} />
            Enable custom site button in header
          </label>
        </div>
        {form.sbEnabled && (<>
          <div className="admin-settings-row">
            <Field label="Icon">
              <input className="admin-input" value={form.sbIcon} onChange={e => set('sbIcon', e.target.value)} disabled={disabled} placeholder="logo.svg" />
            </Field>
            <Field label="Icon — light mode">
              <input className="admin-input" value={form.sbIconLight} onChange={e => set('sbIconLight', e.target.value)} disabled={disabled} placeholder="logo-light.svg" />
            </Field>
            <Field label="Icon — dark mode">
              <input className="admin-input" value={form.sbIconDark} onChange={e => set('sbIconDark', e.target.value)} disabled={disabled} placeholder="logo-dark.svg" />
            </Field>
          </div>
          <Field label="URL" help="Optional. Opens in a new tab when clicked.">
            <input className="admin-input" value={form.sbUrl} onChange={e => set('sbUrl', e.target.value)} disabled={disabled} placeholder="https://www.example.com" />
          </Field>
          <div className="admin-settings-row">
            <Field label="Placement">
              <select className="admin-input" value={form.sbPlacement} onChange={e => set('sbPlacement', e.target.value)} disabled={disabled}>
                <option value="right">Right (after theme toggle)</option>
                <option value="left">Left (before home button)</option>
              </select>
            </Field>
            <Field label="Alignment">
              <select className="admin-input" value={form.sbAlignment} onChange={e => set('sbAlignment', e.target.value)} disabled={disabled}>
                <option value="right">Far edge of screen</option>
                <option value="left">Adjacent to buttons</option>
                <option value="center">Center</option>
              </select>
            </Field>
            <Field label="Alt text" help="Screen reader label.">
              <input className="admin-input" value={form.sbAlt} onChange={e => set('sbAlt', e.target.value)} disabled={disabled} placeholder="My Company" />
            </Field>
          </div>
        </>)}
      </Section>

      <Section title="Defaults">
        <div className="admin-settings-row">
          <Field label="Home button">
            <select className="admin-input" value={form.home} onChange={e => set('home', e.target.value)} disabled={disabled}>
              <option value="site">Site root (/)</option>
              <option value="folder">Folder root</option>
              <option value="false">Disabled</option>
              <option value="_custom">Custom URL</option>
            </select>
          </Field>
          {form.home === '_custom' && (
            <Field label="Custom home URL">
              <input className="admin-input" value={form.homeCustom} onChange={e => set('homeCustom', e.target.value)} disabled={disabled} placeholder="https://example.com" />
            </Field>
          )}
        </div>
        <div className="admin-field">
          <label className="admin-checkbox-label">
            <input type="checkbox" checked={form.toc} onChange={e => set('toc', e.target.checked)} disabled={disabled} />
            Table of contents open by default
          </label>
        </div>
      </Section>

      <Section title="Admin">
        <div className="admin-settings-row">
          <div className="admin-field">
            <label className="admin-checkbox-label">
              <input type="checkbox" checked={form.adminEnabled} onChange={e => set('adminEnabled', e.target.checked)} disabled={disabled || !sensitiveEditable} />
              Admin enabled
            </label>
          </div>
          <div className="admin-field">
            <label className="admin-checkbox-label">
              <input type="checkbox" checked={form.adminReadonly} onChange={e => set('adminReadonly', e.target.checked)} disabled={disabled || !sensitiveEditable} />
              Read-only mode
            </label>
          </div>
        </div>
        {sensitiveEditable ? (
          <div className="admin-settings-row">
            <Field label="New password" help="Leave blank to keep the current password.">
              <input className="admin-input" type="password" value={form.adminPassword} onChange={e => set('adminPassword', e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm password">
              <input className="admin-input" type="password" value={form.adminPasswordConfirm} onChange={e => set('adminPasswordConfirm', e.target.value)} autoComplete="new-password" />
            </Field>
            {form.adminPassword && (
              <p className="admin-field-help" style={{ color: '#cf222e', alignSelf: 'flex-end', paddingBottom: 4 }}>
                Changing the password will require signing in again.
              </p>
            )}
          </div>
        ) : (
          <p className="admin-field-help">Set <code>admin.allowSensitiveEdits: true</code> in content-security.json to enable password and cookie changes.</p>
        )}
      </Section>

      <Section title="Cookies">
        <div className="admin-field">
          <label className="admin-checkbox-label">
            <input type="checkbox" checked={form.cookiesEnabled} onChange={e => set('cookiesEnabled', e.target.checked)} disabled={disabled || !sensitiveEditable} />
            Enable cookie-based password persistence
          </label>
        </div>
        {form.cookiesEnabled && (
          <div className="admin-settings-row">
            <Field label="Cookie prefix">
              <input className="admin-input" value={form.cookiesPrefix} onChange={e => set('cookiesPrefix', e.target.value)} disabled={disabled || !sensitiveEditable} placeholder="md" />
            </Field>
            <Field label="Max age (seconds)" help="Default: 2592000 (30 days)">
              <input className="admin-input" type="number" min="60" value={form.cookiesMaxAge} onChange={e => set('cookiesMaxAge', e.target.value)} disabled={disabled || !sensitiveEditable} />
            </Field>
            <Field label="Domain" help="Optional, e.g. .example.com">
              <input className="admin-input" value={form.cookiesDomain} onChange={e => set('cookiesDomain', e.target.value)} disabled={disabled || !sensitiveEditable} placeholder=".example.com" />
            </Field>
            <div className="admin-field">
              <label className="admin-checkbox-label">
                <input type="checkbox" checked={form.cookiesStoreAdmin} onChange={e => set('cookiesStoreAdmin', e.target.checked)} disabled={disabled || !sensitiveEditable} />
                Store admin token in cookie
              </label>
            </div>
          </div>
        )}
      </Section>

      {!readonly && (
        <div className="admin-settings-actions">
          <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </form>
  )
}
