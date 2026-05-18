import { createHmac } from 'node:crypto'

// Stateless hour-window tokens: sign "admin-token:<hourSlot>" with HMAC-SHA256
// keyed on the admin password. Accept the current hour and the previous one so
// tokens remain valid for up to two hours without any server-side session state.
// Changing the admin password in content-security.json immediately invalidates
// all outstanding tokens (they won't match the new key).

function tokenForHour(password, hour) {
  return createHmac('sha256', password).update(`admin-token:${hour}`).digest('base64url')
}

export function createToken(password) {
  return tokenForHour(password, Math.floor(Date.now() / 3_600_000))
}

export function verifyToken(token, password) {
  const hour = Math.floor(Date.now() / 3_600_000)
  return token === tokenForHour(password, hour) || token === tokenForHour(password, hour - 1)
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
