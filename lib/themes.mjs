// Site themes: the palette and look a site picks with "theme" in content-security.json.
// A theme is not the visitor's light/dark mode (that stays data-theme on <html>, chosen by the
// toggle); in code the site theme is the *palette* and lands on <html data-palette="…">.
//
// Each name here has a stylesheet app/themes/<name>.css imported by app/layout.js, scoped under
// html[data-palette='<name>']. Adding a theme: THEMES.md §4 (and the Themes section of README.md).
// No dependencies, so server and client code can both import it.

export const THEMES = Object.freeze([])

// Returns { theme } with a known theme name or null (the default look), plus a warning when the
// configured value was not usable. Absent, empty and "default" are the default without a warning.
export function normaliseTheme(raw) {
  if (raw === undefined || raw === null) return { theme: null }
  if (typeof raw !== 'string') return { theme: null, warning: 'theme must be a string' }
  const name = raw.trim().toLowerCase()
  if (name === '' || name === 'default') return { theme: null }
  if (!THEMES.includes(name)) return { theme: null, warning: `unknown theme ${JSON.stringify(name)}` }
  return { theme: name }
}
