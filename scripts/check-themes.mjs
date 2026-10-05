#!/usr/bin/env node
// Checks the site themes (THEMES.md §1.4, §5). Node 22, no npm packages.
//
//   node scripts/check-themes.mjs                     static lint of app/themes/*.css
//   node scripts/check-themes.mjs --identity [ref]    the default is unchanged against a git ref
//                                                      (default: main): unwrapping every
//                                                      var(--theme-token, X) to X must give the
//                                                      ref's files byte for byte
//   node scripts/check-themes.mjs --contrast <url>    WCAG 2.2 AA contrast of a themed page in
//                                                      light and dark, in headless google-chrome
//
// Exits non-zero on any failure.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const THEMES_DIR = path.join(ROOT, 'app/themes')
const SHARED = ['base.css', 'hljs.css']
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')

// Seeds every theme defines in both modes (THEMES.md §2.1, §2.2, §2.5).
const SEEDS = [
  'page-bg', 'surface', 'surface-soft', 'text', 'muted', 'border', 'border-strong', 'link', 'shadow',
  'accent-soft', 'mark-bg', 'mark-text', 'code-inline-bg', 'code-inline-border', 'code-bg', 'code-border',
  'code-header-bg',
  'text-strong', 'surface-hover', 'link-hover', 'accent', 'accent-hover', 'on-accent', 'success', 'danger',
  'hl-fg', 'hl-keyword', 'hl-title', 'hl-type', 'hl-attr', 'hl-string', 'hl-constant', 'hl-comment',
  'hl-meta', 'hl-tag', 'hl-section', 'hl-add-fg', 'hl-add-bg', 'hl-del-fg', 'hl-del-bg',
]

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// ── A small CSS reader: comments out, then rules as { selector, body, media } ──────────────────
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}
function parseRules(css, media = null, out = []) {
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const prelude = css.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) parseRules(body, prelude, out)
    else out.push({ selector: prelude.replace(/\s+/g, ' '), body, media })
    i = j
  }
  return out
}
function declarations(body) {
  const out = []
  for (const part of body.split(';')) {
    const k = part.indexOf(':')
    if (k < 0) continue
    out.push([part.slice(0, k).trim(), part.slice(k + 1).trim().replace(/\s+/g, ' ')])
  }
  return out
}
const splitSelectors = (sel) => {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}
// Theme-only tokens: custom properties the default does not define (in the given globals.css
// sources) but that a theme file defines or the default reads with a fallback, var(--token, X).
// The first source is the reference (main); the default may only read these names with a fallback.
function themeTokens(...globalsSources) {
  if (!globalsSources.length) globalsSources = [read('app/globals.css')]
  const defaults = new Set([...stripComments(globalsSources[0]).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  const names = new Set()
  for (const f of readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css'))) {
    for (const m of stripComments(readFileSync(path.join(THEMES_DIR, f), 'utf8')).matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(m[1])
  }
  for (const src of globalsSources) {
    for (const m of src.matchAll(/var\((--[a-z0-9-]+),/g)) names.add(m[1])
  }
  for (const d of defaults) names.delete(d)
  return names
}

// ── Static lint ───────────────────────────────────────────────────────────────────────────────
function lint() {
  const themeFiles = readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css') && !SHARED.includes(f))
  const globals = stripComments(read('app/globals.css'))
  const globalRules = parseRules(globals)

  // Classes styled under html[data-theme=…] in globals.css: look rules must not target them,
  // because html[data-palette] X ties with html[data-theme] X (THEMES.md §1.4).
  const lastCompound = (sel) => sel.replace(/::?[a-z-]+(\([^)]*\))?/g, ' ').trim().split(/[\s>+~]+/).pop()
  const darkVariant = new Set()
  for (const r of globalRules) {
    for (const s of splitSelectors(r.selector)) {
      if (!s.startsWith('html[data-theme=')) continue
      for (const m of lastCompound(s).matchAll(/\.([a-z0-9_-]+)/gi)) darkVariant.add(m[1])
    }
  }

  for (const file of [...SHARED, ...themeFiles]) {
    const css = stripComments(readFileSync(path.join(THEMES_DIR, file), 'utf8'))
    const rules = parseRules(css)
    const name = file.replace(/\.css$/, '')
    const shared = SHARED.includes(file)
    const scope = shared ? /^(:where\(html\[data-palette\]\)|html\[data-palette\])(?![=\w-])/ : new RegExp(`^html\\[data-palette='${name}'\\]`)
    const unscoped = rules.flatMap((r) => splitSelectors(r.selector)).filter((s) => !scope.test(s))
    check(unscoped.length === 0, `${file}: every selector is scoped${unscoped.length ? ` (not: ${unscoped.join(' | ')})` : ''}`)
    check(!/:root\b/.test(css), `${file}: no :root`)
    check(!/@layer\b/.test(css), `${file}: no @layer`)
    check(!/!important/.test(css), `${file}: no !important`)
    const consent = rules.filter((r) => /\.sgw-cookie-(banner|backdrop|modal-bg)\b/.test(r.selector) &&
      declarations(r.body).some(([p]) => /^(opacity|pointer-events|display)$/.test(p)))
    check(consent.length === 0, `${file}: leaves the consent banner's opacity, pointer-events and display alone`)
    if (file !== 'hljs.css') {
      const clash = rules.filter((r) => !/^--|^color-scheme$/.test(declarations(r.body)[0]?.[0] ?? '--'))
        .flatMap((r) => splitSelectors(r.selector))
        .filter((s) => [...lastCompound(s).matchAll(/\.([a-z0-9_-]+)/gi)].some((m) => darkVariant.has(m[1])))
      check(clash.length === 0, `${file}: no look rule on a selector globals.css styles under html[data-theme]${clash.length ? ` (${clash.join(' | ')})` : ''}`)
    }
    if (shared) continue

    // The four sections of a theme file
    const sel = (s) => s.replace(/\s+/g, ' ').trim()
    const base = `html[data-palette='${name}']`
    const find = (selector, media) => rules.filter((r) => sel(r.selector) === selector && (media ? r.media && /prefers-color-scheme:\s*dark/.test(r.media) : !r.media))
    const tokensOf = (r) => new Map(declarations(r.body).filter(([p]) => p.startsWith('--') || p === 'color-scheme'))
    const [light] = find(`${base}, ${base}[data-theme='light']`)
    const [osDark] = find(`${base}:not([data-theme='light'])`, true)
    const [dark] = find(`${base}[data-theme='dark']`)
    const modeIndependent = find(base)
    check(!!light && !!osDark && !!dark, `${file}: has a light block, an OS-dark block and an explicit dark block`)
    if (!light || !osDark || !dark) continue
    const L = tokensOf(light)
    const O = tokensOf(osDark)
    const D = tokensOf(dark)
    for (const [label, m, scheme] of [['light', L, 'light'], ['OS dark', O, 'dark'], ['dark', D, 'dark']]) {
      const missing = SEEDS.filter((t) => !m.has(`--${t}`))
      check(missing.length === 0, `${file}: ${label} block defines every seed${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)
      check(m.get('color-scheme') === scheme, `${file}: ${label} block sets color-scheme: ${scheme}`)
    }
    const same = O.size === D.size && [...O].every(([k, v]) => D.get(k) === v)
    check(same, `${file}: the two dark blocks are identical`)
    const leak = [...L.keys()].filter((k) => !D.has(k))
    check(leak.length === 0, `${file}: every light token is restated for dark (the light base always matches)${leak.length ? ` (${leak.join(', ')})` : ''}`)
    const mi = new Set(modeIndependent.flatMap((r) => [...tokensOf(r).keys()]))
    const twice = [...mi].filter((k) => L.has(k) || D.has(k))
    check(twice.length === 0, `${file}: a token is defined in one section only${twice.length ? ` (${twice.join(', ')})` : ''}`)
  }

  // Every highlight.js selector in globals.css has its mirror in hljs.css
  const hljs = new Set(parseRules(stripComments(readFileSync(path.join(THEMES_DIR, 'hljs.css'), 'utf8')))
    .flatMap((r) => splitSelectors(r.selector)))
  const wanted = new Set(globalRules.flatMap((r) => splitSelectors(r.selector))
    .filter((s) => /\.hljs/.test(s))
    .map((s) => s.replace(/^html\[data-theme='(dark|light)'\]\s+/, '')))
  const unmirrored = [...wanted].filter((s) => !hljs.has(s === '.hljs' ? 'html[data-palette] code.hljs' : `html[data-palette] .hljs ${s}`))
  check(unmirrored.length === 0, `hljs.css mirrors all ${wanted.size} highlight.js selectors of globals.css${unmirrored.length ? ` (missing: ${unmirrored.join(', ')})` : ''}`)

  // Registry, imports and files agree
  const registry = [...read('lib/themes.mjs').match(/THEMES\s*=\s*Object\.freeze\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  const imported = [...read('app/layout.js').matchAll(/import '\.\/themes\/([a-z0-9-]+)\.css'/g)].map((m) => m[1]).filter((n) => !SHARED.includes(`${n}.css`))
  const sharedImported = SHARED.every((f) => read('app/layout.js').includes(`import './themes/${f}'`))
  check(sharedImported, 'app/layout.js imports base.css and hljs.css')
  check(registry.length === imported.length && registry.every((n) => imported.includes(n)),
    `THEMES in lib/themes.mjs (${registry.join(', ')}) matches the theme files app/layout.js imports (${imported.join(', ')})`)
  const inert = themeFiles.map((f) => f.replace(/\.css$/, '')).filter((n) => !registry.includes(n))
  if (inert.length) console.log(`     not registered (inert): ${inert.join(', ')}`)

  // The default never defines a theme token, and never uses one without its fallback. Measured
  // against main's globals.css, so a token newly defined on this branch's globals.css is caught.
  let mainGlobals = read('app/globals.css')
  try { mainGlobals = execFileSync('git', ['show', 'main:app/globals.css'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }) } catch { /* no git: compare with itself */ }
  const tokens = themeTokens(mainGlobals, read('app/globals.css'))
  const defined = [...globals.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).filter((t) => tokens.has(t))
  check(defined.length === 0, `globals.css defines no theme token${defined.length ? ` (${[...new Set(defined)].join(', ')})` : ''}`)
  const bare = [...globals.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((t) => tokens.has(t))
  check(bare.length === 0, `globals.css reads every theme token with a fallback${bare.length ? ` (bare: ${[...new Set(bare)].join(', ')})` : ''}`)
}

// ── Source identity: the default is unchanged ─────────────────────────────────────────────────
function unwrap(src, tokens) {
  let out = ''
  let i = 0
  for (;;) {
    const m = /var\((--[a-z0-9-]+),\s?/g
    m.lastIndex = i
    let hit
    while ((hit = m.exec(src)) && !tokens.has(hit[1])) { /* skip non-theme tokens */ }
    if (!hit) return out + src.slice(i)
    out += src.slice(i, hit.index)
    // find the matching close paren of var(
    let depth = 1
    let j = hit.index + hit[0].length
    const start = j
    while (j < src.length && depth) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') depth--
      j++
    }
    out += unwrap(src.slice(start, j - 1), tokens)
    i = j
  }
}
function identity(ref) {
  const tokens = themeTokens(execFileSync('git', ['show', `${ref}:app/globals.css`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }), read('app/globals.css'))
  for (const file of ['app/globals.css', 'app/admin/AdminSettings.js', 'app/admin/AdminSecurity.js']) {
    const before = execFileSync('git', ['show', `${ref}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    const after = read(file)
    const a = unwrap(before, tokens)
    const b = unwrap(after, tokens)
    let line = 0
    if (a !== b) {
      const al = a.split('\n'); const bl = b.split('\n')
      while (line < al.length && al[line] === bl[line]) line++
    }
    check(a === b, `${file}: equals ${ref} once theme tokens are unwrapped${a === b ? '' : ` (first difference at line ${line + 1})`}`)
  }
}

// ── Contrast in a real browser ────────────────────────────────────────────────────────────────
const T = 4.5 // text
const U = 3   // UI parts and graphics
// [label, fg token, background tokens from top to the opaque ground, threshold]
const PAIRS = [
  ['body text on page', 'text', ['page-bg'], T],
  ['body text on card', 'text', ['surface'], T],
  ['body text on soft surface', 'text', ['surface-soft'], T],
  ['headings on card', 'text-strong', ['surface'], T],
  ['headings on soft surface', 'text-strong', ['surface-soft'], T],
  ['muted on page', 'muted', ['page-bg'], T],
  ['muted on card', 'muted', ['surface'], T],
  ['muted on soft surface', 'muted', ['surface-soft'], T],
  ['code language on code header', 'muted', ['code-header-bg'], T],
  ['link on card', 'link', ['surface'], T],
  ['link on soft surface', 'link', ['surface-soft'], T],
  ['link on page', 'link', ['page-bg'], T],
  ['link hover on card', 'link-hover', ['surface'], T],
  ['inline code', 'code-inline-fg', ['code-inline-bg', 'surface'], T],
  ['mark', 'mark-text', ['mark-bg', 'surface'], T],
  ['headings on selection', 'text-strong', ['selection-bg', 'surface'], T],
  ['body text on selection', 'text', ['selection-bg', 'surface'], T],
  ['primary button', 'button-primary-fg', ['button-primary-bg'], T],
  ['primary button hover', 'button-primary-fg', ['button-primary-hover-bg'], T],
  ['success on card', 'success', ['surface'], T],
  ['danger on card', 'danger', ['surface'], T],
  ['danger on soft surface', 'danger', ['surface-soft'], T],
  ['error bar', 'danger-fg', ['danger-bg', 'surface'], T],
  ['status bar', 'success-fg', ['success-bg', 'surface'], T],
  ['danger button hover', 'danger-hover-fg', ['danger-hover-bg', 'surface'], T],
  ['nav at rest', 'text', ['nav-card-bg'], T],
  ['nav hover', 'nav-hover-fg', ['nav-hover-bg', 'nav-card-bg'], T],
  ['nav current', 'nav-active-fg', ['nav-active-bg', 'nav-card-bg'], T],
  ['tool button', 'control-fg', ['control-bg', 'surface'], T],
  ['tool button hover', 'control-hover-fg', ['control-hover-bg', 'surface'], T],
  ['tool button hover, fg kept (admin, Mermaid)', 'control-fg', ['control-hover-bg', 'surface'], T],
  ['TOC button pressed', 'control-pressed-fg', ['control-pressed-bg', 'surface'], T],
  ['field text', 'text', ['field-bg', 'surface'], T],
  ['table head', 'table-head-fg', ['table-head-bg', 'surface'], T],
  ['table row hover', 'text', ['hover-bg', 'surface'], T],
  ['blockquote', 'blockquote-fg', ['surface'], T],
  ['cookie Accept', 'consent-on-accent', ['consent-accent', 'surface'], T],
  ['cookie Accept hover', 'consent-on-accent', ['consent-accent-hover', 'surface'], T],
  ['cookie Reject hover', 'consent-outline-hover-fg', ['consent-outline-hover-bg', 'surface'], T],
  ['cookie banner link hover', 'consent-accent', ['surface'], T],
  ['code foreground', 'hl-fg', ['code-bg'], T],
  ...['keyword', 'title', 'type', 'attr', 'string', 'constant', 'comment', 'meta', 'tag', 'section']
    .map((r) => [`syntax ${r}`, `hl-${r}`, ['code-bg'], T]),
  ['syntax keyword on a bare pre', 'hl-keyword', ['surface-soft'], T],
  ['syntax comment on a bare pre', 'hl-comment', ['surface-soft'], T],
  ['diff addition', 'hl-add-fg', ['hl-add-bg', 'code-bg'], T],
  ['diff deletion', 'hl-del-fg', ['hl-del-bg', 'code-bg'], T],
  ['Mermaid node text', 'mermaid-node-text', ['mermaid-node-bg'], T],
  ['Mermaid edge label', 'mermaid-text', ['mermaid-bg'], T],
  ['Mermaid note text', 'mermaid-note-text', ['mermaid-note-bg'], T],
  ['focus ring vs page', 'accent', ['page-bg'], U],
  ['focus ring vs card', 'accent', ['surface'], U],
  ['focus ring vs soft surface', 'accent', ['surface-soft'], U],
  ['field border vs card', 'field-border', ['surface'], U],
  ['field border vs field', 'field-border', ['field-bg', 'surface'], U],
  ['checkbox border vs card', 'border-strong', ['surface'], U],
  ['checkbox checked vs card', 'accent', ['surface'], U],
  ['toggle off: track border vs modal', 'toggle-track-border', ['surface'], U],
  ['toggle off: knob on track', 'toggle-knob', ['toggle-track-bg', 'surface'], U],
  ['toggle on: track vs modal', 'toggle-on-bg', ['surface'], U],
  ['toggle on: knob on track', 'toggle-on-knob', ['toggle-on-bg', 'surface'], U],
  ['nav current marker vs card', 'nav-active-border', ['nav-card-bg'], U],
  ['Mermaid node border vs chart', 'mermaid-node-border', ['mermaid-bg'], U],
  ['Mermaid line vs chart', 'mermaid-line', ['mermaid-bg'], U],
]
// Real elements, measured where present: [selector, threshold, label]
const ELEMENTS = [
  ['.markdown-body p', T, 'paragraph'],
  ['.markdown-body a:not([aria-hidden])', T, 'prose link'],
  ['.markdown-body h1', T, 'h1'],
  ['.markdown-body h6', T, 'h6'],
  ['.markdown-body th', T, 'table head'],
  ['.markdown-body td', T, 'table cell'],
  ['.markdown-body blockquote p', T, 'blockquote'],
  ['.markdown-body :not(pre) > code', T, 'inline code'],
  ['.markdown-body mark', T, 'mark'],
  ['.code-lang', T, 'code language'],
  ['code.hljs', T, 'code'],
  ...['keyword', 'string', 'comment', 'title', 'number', 'attr', 'built_in', 'meta', 'section', 'name']
    .map((c) => [`.hljs-${c}`, T, `syntax .hljs-${c}`]),
  ['.header-title', T, 'header title'],
  ['.toc-link', T, 'TOC link'],
  ['.toc-link.active', T, 'TOC current'],
  ['.sitemap-link', T, 'site map link'],
  ['.sitemap-link.is-current', T, 'site map current'],
  ['.security-gate-heading', T, 'gate heading'],
  ['.security-gate-sub', T, 'gate text'],
  ['.security-gate-button', T, 'gate button'],
  ['.security-gate-input', T, 'gate input'],
  ['.sgw-cookie-heading', T, 'cookie heading'],
  ['.sgw-cookie-text', T, 'cookie text'],
  ['.sgw-cookie-accept', T, 'cookie Accept'],
  ['.sgw-cookie-outline', T, 'cookie Reject'],
  ['.admin-btn', T, 'admin button'],
  ['.admin-btn-primary', T, 'admin primary button'],
]

async function contrast(url) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const profile = mkdtempSync(path.join(os.tmpdir(), 'theme-check-'))
  const chrome = spawn('google-chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = await new Promise((resolve, reject) => {
    let err = ''
    chrome.stderr.on('data', (d) => {
      err += d
      const m = err.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) resolve(m[1])
    })
    chrome.on('exit', (code) => reject(new Error(`chrome exited (${code}): ${err}`)))
  })
  const ws = new WebSocket(wsUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

  // In-page measuring code: resolves tokens through a probe element, composites alpha, and walks
  // an element's ancestors for its effective background.
  const inPage = (pairs, elements) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
      return [p[0], p[1], p[2], p[3] ?? 1]
    }
    const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
    const probe = document.createElement('div')
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const token = (t) => {
      probe.style.color = ''
      probe.style.color = `var(--${t})`
      const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${t}`).trim()
      if (!raw) return null
      return parse(getComputedStyle(probe).color)
    }
    const flat = (layers) => {
      let acc = layers[layers.length - 1]
      for (let i = layers.length - 2; i >= 0; i--) acc = over(layers[i], acc)
      return acc
    }
    const results = []
    for (const [label, fg, bgs, need] of pairs) {
      const f = token(fg)
      const b = bgs.map(token)
      if (!f || b.some((x) => !x)) { results.push({ label, skipped: `${fg} or ${bgs.join('/')} is not a colour` }); continue }
      const ground = flat(b)
      const r = ratio(over(f, ground), ground)
      results.push({ label, ratio: r, need, detail: `${hex(over(f, ground))} on ${hex(ground)}` })
    }
    const background = (el) => {
      const layers = []
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor)
        if (c && c[3] > 0) layers.push(c)
        if (c && c[3] >= 1) break
      }
      layers.push([255, 255, 255, 1])
      return flat(layers)
    }
    for (const [selector, need, label] of elements) {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getClientRects().length)
      if (!el) continue
      const ground = background(el)
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      const r = ratio(over(fg, ground), ground)
      results.push({ label: `element: ${label}`, ratio: r, need, detail: `${hex(over(fg, ground))} on ${hex(ground)}` })
    }
    probe.remove()
    return { palette: document.documentElement.getAttribute('data-palette'), theme: document.documentElement.getAttribute('data-theme'), results }
  }

  try {
    for (const mode of ['light', 'dark']) {
      const { browserContextId } = await send('Target.createBrowserContext')
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      const s = (m, p) => send(m, p, sessionId)
      await s('Page.enable')
      await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
      await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
      const evaluate = async (expression) =>
        (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
      const load = async (fn) => {
        await fn()
        await sleep(300)
        for (let i = 0; i < 80 && (await evaluate('document.readyState')) !== 'complete'; i++) await sleep(100)
        await sleep(1500)
      }
      await load(() => s('Page.navigate', { url }))
      await evaluate(`localStorage.setItem('theme', '${mode}')`)
      await load(() => s('Page.reload'))
      // The cookie banner waits for a scroll; nudge it so its buttons can be measured too.
      for (let t = 0; t < 3000; t += 250) {
        if (await evaluate("!!document.querySelector('.sgw-cookie-banner--visible')")) break
        await evaluate('window.scrollBy(0, 200)')
        await sleep(250)
      }
      await sleep(800)
      const out = await evaluate(`(${inPage.toString()})(${JSON.stringify(PAIRS)}, ${JSON.stringify(ELEMENTS)})`)
      if (!out.palette) {
        check(false, `${mode}: ${url} has no site theme (data-palette); select one in content-security.json`)
        continue
      }
      console.log(`\n── ${out.palette}, ${mode} (data-theme=${out.theme}) ──`)
      for (const r of out.results) {
        if (r.skipped) { console.log(`skip ${r.label}: ${r.skipped}`); continue }
        check(r.ratio + 1e-9 >= r.need, `${r.label}: ${r.ratio.toFixed(2)} (needs ${r.need}) ${r.detail}`)
      }
    }
  } finally {
    ws.close()
    chrome.kill()
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }
}

const args = process.argv.slice(2)
if (args[0] === '--identity') identity(args[1] || 'main')
else if (args[0] === '--contrast') {
  if (!args[1]) { console.error('usage: check-themes.mjs --contrast <url>'); process.exit(2) }
  await contrast(args[1])
} else lint()

console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
