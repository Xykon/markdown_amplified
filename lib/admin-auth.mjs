import { createHmac, timingSafeEqual } from 'node:crypto'

// Stateless hour-window tokens: sign "admin-token:<hourSlot>" with HMAC-SHA256
// keyed on ADMIN_TOKEN_SECRET + admin password. Accept the current hour and
// the previous one so tokens remain valid for up to two hours without any
// server-side session state.
//
// The optional ADMIN_TOKEN_SECRET env var is mixed into the HMAC key so that
// knowledge of the admin password alone is not enough to forge a token —
// an attacker would also need the server-side secret. Changing either the
// password or the secret immediately invalidates all outstanding tokens.

function hmacKey(password) {
  // process.env.ADMIN_TOKEN_SECRET is referenced as a static member expression
  // so webpack DefinePlugin inlines it at build time (required for Amplify
  // WEB_COMPUTE Lambda where dynamic env access is not preserved).
  const secret = process.env.ADMIN_TOKEN_SECRET || ''
  return secret + '\x00' + password
}

function tokenForHour(password, hour) {
  return createHmac('sha256', hmacKey(password)).update(`admin-token:${hour}`).digest('base64url')
}

// Constant-time string comparison. Returns false for differing lengths
// without leaking the comparison result through timing.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function createToken(password) {
  return tokenForHour(password, Math.floor(Date.now() / 3_600_000))
}

export function verifyToken(token, password) {
  if (!token) return false
  const hour = Math.floor(Date.now() / 3_600_000)
  // Always compare against both candidates to avoid early-exit timing leaks.
  const a = safeEqual(token, tokenForHour(password, hour))
  const b = safeEqual(token, tokenForHour(password, hour - 1))
  return a || b
}

// Extract and verify the Bearer token from a request.
// Returns the admin config object on success, null otherwise.
export async function requireAdminAuth(request) {
  const { loadAdminConfig } = await import('./security.mjs')
  const adminConfig = await loadAdminConfig()
  if (!adminConfig) return null
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  return verifyToken(token, adminConfig.password) ? adminConfig : null
}
