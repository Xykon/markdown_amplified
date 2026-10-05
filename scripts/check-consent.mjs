#!/usr/bin/env node
// Proves the analytics consent rules in a real browser (headless google-chrome, Node 22, no npm
// packages). Run it against a site whose content-security.json sets ga_measurement_id with the
// banner on:
//
//   node scripts/check-consent.mjs http://ma.ehlers.localhost:3100/
//
// A made-up measurement id (G-TEST1234) is enough: Google serves gtag.js for any id, so the test
// never has to send hits to a real property. Checked:
//   1. Before any choice, nothing is fetched from Google and no _ga cookie exists.
//   2. Reject: still nothing from Google, on this page and after a reload.
//   3. Accept: gtag.js loads, and _ga is set for this host only (no Domain attribute).
//   4. A reload with Accept stored loads gtag.js again, and the Cookie settings button is there.
//   5. Withdrawing through Cookie settings deletes _ga and reloads without any Google request.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const url = process.argv[2] ?? 'http://ma.ehlers.localhost:3100/'
const host = new URL(url).hostname
const GOOGLE = /(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = mkdtempSync(path.join(os.tmpdir(), 'consent-check-'))
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
const listeners = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(`${msg.error.message}`))
    else resolve(msg.result)
  } else if (msg.method) {
    for (const l of listeners) l(msg)
  }
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// One fresh browser context (its own cookies and storage) per scenario.
async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext')
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const google = []
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId || msg.method !== 'Network.requestWillBeSent') return
    try {
      if (GOOGLE.test(new URL(msg.params.request.url).hostname)) google.push(msg.params.request.url)
    } catch {}
  })
  const s = (method, params) => send(method, params, sessionId)
  await s('Network.enable')
  await s('Page.enable')
  const evaluate = async (expression) =>
    (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
  const load = async (target) => {
    await s('Page.navigate', { url: target })
    for (let i = 0; i < 50 && (await evaluate('document.readyState')) !== 'complete'; i++) await sleep(100)
  }
  const reload = async () => {
    await s('Page.reload')
    await sleep(300)
    for (let i = 0; i < 50 && (await evaluate('document.readyState')) !== 'complete'; i++) await sleep(100)
  }
  const gaCookies = async () => (await s('Network.getCookies', { urls: [url] })).cookies.filter((c) => /^_ga/.test(c.name))
  const waitFor = async (expression, ms = 8000) => {
    for (let t = 0; t < ms; t += 200) {
      if (await evaluate(expression)) return true
      await sleep(200)
    }
    return false
  }
  return { google, evaluate, load, reload, gaCookies, waitFor }
}

try {
  // ── Reject ──
  {
    const p = await openPage()
    await p.load(url)
    // The banner shows after a scroll, or after 1.2 s on a page too short to scroll.
    await p.evaluate('window.scrollBy(0, 400)')
    const banner = await p.waitFor("!!document.querySelector('.sgw-cookie-banner--visible .sgw-cookie-accept')")
    check(banner, 'the banner appears')
    check(p.google.length === 0, `no request to Google before a choice (${p.google.length})`)
    check((await p.gaCookies()).length === 0, 'no _ga cookie before a choice')
    await p.evaluate("document.querySelector('.sgw-cookie-banner .sgw-cookie-outline').click()")
    await sleep(2500)
    await p.reload()
    await sleep(2500)
    check(p.google.length === 0, `Reject: no request to Google, also after a reload (${p.google.length})`)
    check((await p.gaCookies()).length === 0, 'Reject: no _ga cookie')
  }

  // ── Accept, reload, withdraw ──
  {
    const p = await openPage()
    await p.load(url)
    await p.evaluate('window.scrollBy(0, 400)')
    await p.waitFor("!!document.querySelector('.sgw-cookie-banner--visible .sgw-cookie-accept')")
    check(p.google.length === 0, 'no request to Google before Accept')
    await p.evaluate("document.querySelector('.sgw-cookie-accept').click()")
    const loaded = await p.waitFor('!!window.google_tag_manager || document.cookie.includes("_ga=")')
    check(loaded && p.google.some((u) => u.includes('googletagmanager.com/gtag/js')), 'Accept: gtag.js loads')
    await p.waitFor('document.cookie.includes("_ga=")')
    const cookies = await p.gaCookies()
    check(cookies.length > 0, `Accept: _ga is set (${cookies.map((c) => c.name).join(', ')})`)
    check(cookies.every((c) => c.domain === host), `Accept: _ga is for ${host} only (${[...new Set(cookies.map((c) => c.domain))].join(', ')})`)

    const before = p.google.length
    await p.reload()
    check(await p.waitFor('!!window.google_tag_manager'), 'a reload with Accept stored loads gtag.js again')
    check(p.google.length > before, 'and requests Google again')
    check(await p.waitFor("!!document.querySelector('.sgw-cookie-settings')"), 'the Cookie settings button is there')

    await p.evaluate("document.querySelector('.sgw-cookie-settings').click()")
    await p.waitFor("!!document.querySelector('.sgw-cookie-modal')")
    await p.evaluate(`(() => {
      const box = document.querySelector('.sgw-cookie-modal input[type=checkbox]:not([disabled])')
      if (box.checked) box.click()
      document.querySelector('.sgw-modal-save-btn').click()
    })()`)
    await sleep(1500)
    for (let i = 0; i < 50 && (await p.evaluate('document.readyState')) !== 'complete'; i++) await sleep(100)
    const afterWithdraw = p.google.length
    await sleep(2500)
    check((await p.gaCookies()).length === 0, 'withdrawn: the _ga cookies are gone')
    check(!(await p.evaluate('!!window.__maGtagLoaded')), 'withdrawn: the page reloaded without the tag')
    check(p.google.length === afterWithdraw, `withdrawn: no further request to Google (${p.google.length - afterWithdraw})`)
  }
} finally {
  ws.close()
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall consent checks passed')
