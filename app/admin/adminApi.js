'use client'

export const TOKEN_KEY = 'admin-token'

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function setToken(t) {
  try { sessionStorage.setItem(TOKEN_KEY, t) } catch { }
}

export function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getToken()}`, ...extra }
}
