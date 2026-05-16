import fs from 'fs'
import path from 'path'
import { webcrypto } from 'node:crypto'

const CONFIG_PATH = path.join(process.cwd(), 'content-security.json')
const PBKDF2_ITERATIONS = 100_000

export function loadSecurityRules() {
  if (!fs.existsSync(CONFIG_PATH)) return []
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return Array.isArray(data.rules) ? data.rules : []
  } catch {
    return []
  }
}

// Returns the most specific matching rule for a given file path.
// filePath is relative to the content dir, forward slashes (e.g. "private/doc.md").
// Directory rules end with "/" and match any file under that directory.
// File rules match exactly. Longer match length wins.
export function findRule(filePath, rules) {
  let best = null
  for (const rule of rules) {
    if (!rule.match) continue
    const m = rule.match
    const matched = m.endsWith('/') ? filePath.startsWith(m) : filePath === m
    if (matched && (!best || m.length > best.match.length)) {
      best = rule
    }
  }
  return best
}

export function isWithinDateRange(rule) {
  if (!rule) return true
  const now = new Date()
  if (rule.validFrom && now < new Date(rule.validFrom)) return false
  if (rule.validUntil && now > new Date(rule.validUntil)) return false
  return true
}

// Encrypts plaintext with AES-256-GCM using PBKDF2 key derivation.
// Returns { salt, iv, ciphertext } as base64 strings.
export async function encryptContent(plaintext, password) {
  const { subtle, getRandomValues } = webcrypto
  const enc = new TextEncoder()
  const salt = getRandomValues(new Uint8Array(16))
  const iv = getRandomValues(new Uint8Array(12))

  const keyMaterial = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))

  return {
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  }
}
