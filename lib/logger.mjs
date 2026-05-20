// lib/logger.mjs — centralised debug toggle.
//
// Set DEBUG = true, commit, and redeploy to enable verbose logging.
// Revert to false and redeploy to silence it again.
//
// Works in both Edge Runtime (middleware) and Node.js (server components,
// route handlers, lib modules) — no Node.js-specific APIs used here.

export const DEBUG = false // <-- toggle me!

/** Emit a debug-only log line. No-op unless DEBUG is true. */
export function dbg(...args) {
  if (DEBUG) console.log('[dbg]', ...args)
}
