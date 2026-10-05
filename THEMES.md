# Themes

A site can pick a **theme**: a palette and a few shape choices that apply to every page, in both light and dark
mode. With no theme configured, the viewer looks exactly as it did before themes existed. The first theme is
**valley**, the look of the AI Valley analytics dashboard. A corporate **sgwireless** theme is expected next; this
note gives its skeleton and the recipe for writing it.

This is the design note for the theme system (branch `theme-valley`, from `main` 25665c6). It is implemented on
that branch; §7 lists where the implementation departs from the note and why. Line numbers such as
`globals.css:119` refer to `app/globals.css` at 25665c6.

**Terms.** A *theme* is the site's palette and look (`valley`), chosen by the site owner. A *mode* is light or dark,
chosen by the visitor. The mode keeps its old names (`data-theme` on `<html>`, `localStorage.theme`,
`ThemeContext`), because renaming them would change the default and drop visitors' saved choices. In code, the
site theme is called the **palette** (`data-palette`), so the two never collide.

---

## 1. Mechanism

### 1.1 Choosing a theme

The site's `content-security.json` selects the theme:

```json
{ "theme": "valley" }
```

- **Where the file comes from.** It is the file `loadConfig()` already reads (`lib/security.mjs:55-101`). A root
  `content-security.json` wins. Without one, the content provider's copy is used: the S3 bucket on S3-backed sites
  such as projects.sgwireless.com, otherwise `content/` or `content.default/`. No environment variable selects a
  theme. The config file is the single source, so git-backed and S3-backed sites work the same way.
- **Registry.** A new module, `lib/themes.mjs`, holds the list of themes and the normalisation rule. It has no
  dependencies, so both server and client code can import it.

  ```js
  export const THEMES = Object.freeze(['valley'])        // 'sgwireless' is added when its palette exists
  export function normaliseTheme(raw) {
    if (raw === undefined || raw === null) return { theme: null }
    if (typeof raw !== 'string') return { theme: null, warning: 'theme must be a string' }
    const name = raw.trim().toLowerCase()
    if (name === '' || name === 'default') return { theme: null }
    if (!THEMES.includes(name)) return { theme: null, warning: `unknown theme ${JSON.stringify(raw)}` }
    return { theme: name }
  }
  ```

- **Loader.** `loadThemeConfig()` in `lib/security.mjs` sits next to `loadAnalyticsConfig()`. It returns the theme
  name or `null`. When the value is unusable it logs one line with `console.warn`, not `dbg`, so the line appears
  in production. It logs once per loaded config object, which means at most once per 60-second cache refresh per
  instance:

  ```
  [theme] unknown theme "nope" in content-security.json; using the default theme (known: valley)
  ```

- **Admin.** No change is needed. `formToConfig` spreads the existing config (`AdminSettings.js:52`) and the PUT
  stores the whole object, so a `theme` key survives admin saves. A theme dropdown in Settings is a possible later
  addition (§6).
- **Timing on S3 sites.** A theme edited in the bucket appears within the 60-second config cache on each instance.
  The prerendered 404 page keeps the build-time theme until the next build (§1.10).

### 1.2 Applying the theme on the server

`app/layout.js` already awaits the config on every request. It now reads the theme in the same call:

```js
const [analytics, theme] = await Promise.all([loadAnalyticsConfig(), loadThemeConfig()])
return (
  <html lang="en" {...(theme ? { 'data-palette': theme } : {})}>
```

- **With no theme, the attribute is absent**, so the default HTML is byte-identical to today's.
- **Why not `data-theme`.** That attribute already means the mode. It is set by `ThemeContext.js:16,20,30`, read
  by about 40 CSS selectors and watched by Mermaid's observer (`MarkdownRenderer.js:199,214,223`).
- **Hydration.** React owns `lang` and `data-palette`. `ThemeContext` sets `data-theme` imperatively after mount, so
  that attribute survives client navigation and `router.refresh()`. The palette does not change on the client.
  Navigation does not re-render the root layout, so a changed config shows on the next full page load.

### 1.3 Files

| File | Status | Role |
|---|---|---|
| `lib/themes.mjs` | new | Registry and `normaliseTheme()` (§1.1). |
| `lib/security.mjs` | changed | Adds `loadThemeConfig()`. |
| `app/layout.js` | changed | Adds the `data-palette` attribute, and imports `./themes/base.css`, `./themes/hljs.css` and `./themes/valley.css` after `./globals.css` and the KaTeX CSS. |
| `app/globals.css` | changed | Only `literal → var(--token, literal)` substitutions (§1.5). No new declarations and no new token definitions. |
| `app/themes/base.css` | new | Shared theme layer for every theme: role defaults derived from the seed tokens, plus the rules that only themes get (§1.6). |
| `app/themes/hljs.css` | new | highlight.js colours driven by `--hl-*` tokens (§1.7). |
| `app/themes/valley.css` | new | The valley seeds, role overrides and look rules (§2, §3). |
| `app/themes/sgwireless.css` | new, **inert** | Skeleton (§4.2). It is not imported and not registered until marketing supplies a palette. |
| `app/[...slug]/MarkdownRenderer.js` | changed | Mermaid reads theme tokens when a palette is set (§1.8). |
| `app/admin/AdminSettings.js` | changed | Line 325: the inline `'#cf222e'` becomes `'var(--danger, #cf222e)'`. |
| `scripts/check-themes.mjs` | new | Static lint plus a browser contrast probe (§5). |
| `README.md`, `content-security.json.example` | changed | A Themes section and the `theme` key (§4.3). |

CSS cannot be imported conditionally in the app router, so every registered theme's file is always loaded. Each
file is scoped under `html[data-palette='<name>']` and does nothing on other sites. The CSS delta is estimated at
about 12 KB, or about 3 KB gzipped; §5.6 measures it.

### 1.4 How a theme file is built, and why it wins

A theme file has four sections. Each section has a fixed selector shape:

```css
/* 1. Mode-independent: fonts, radii, role overrides that do not depend on the mode */
html[data-palette='valley'] { … }

/* 2. Light. This is also the base before hydration when the OS is light, and every printout. The doubled
   attribute lifts the first selector to (0,2,1). */
html[data-palette='valley'][data-palette],
html[data-palette='valley'][data-theme='light'] { color-scheme: light; …every seed… }

/* 3. Dark, on screen only, written twice: OS dark before hydration, and the explicit toggle. Both blocks carry the same declarations. */
@media screen and (prefers-color-scheme: dark) {
  html[data-palette='valley']:not([data-theme='light']) { color-scheme: dark; …every seed… }
}
@media screen {
  html[data-palette='valley'][data-theme='dark'] { color-scheme: dark; …every seed… }
}

/* 4. Look: structural rules (§3). Only for selectors that have no html[data-theme=…] variant in globals.css. */
html[data-palette='valley'] .markdown-body hr { height: 1px; }
```

**Specificity ladder.** Themes win over the default by specificity, never by source order. Next.js may reorder CSS
chunks, so order between files cannot be relied on. The one order a theme does rely on is inside its own file: the
light block and the dark blocks are all (0,2,1), and the dark blocks come later.

| Rule | Selector | Specificity | Beats |
|---|---|---|---|
| Default tokens, light and OS dark | `:root`, `@media … :root` | (0,1,0) | |
| Default tokens, explicit mode | `html[data-theme='dark']`, `html[data-theme='light']` | (0,1,1) | |
| Role defaults in `base.css` | `:where(html[data-palette])` | (0,0,0) | Nothing. Any theme block overrides them. The default never defines these tokens, so there is no tie. |
| Theme section 1 | `html[data-palette='v']` | (0,1,1) | Default `:root`. Defines only tokens the default never defines, so it ties with nothing. |
| Theme light base | `html[data-palette='v'][data-palette]` | (0,2,1) | Default `:root` and both default `html[data-theme=…]` blocks (0,1,1). In print, where the dark blocks do not apply, this is what makes a dark page print light. |
| Theme light (explicit) | `html[data-palette='v'][data-theme='light']` | (0,2,1) | Default `html[data-theme='light']` (0,1,1) |
| Theme dark (OS, before hydration) | `html[data-palette='v']:not([data-theme='light'])` inside `@media screen and (prefers-color-scheme: dark)` | (0,2,1) | Default `:root`; the theme's own light base by order in the file |
| Theme dark (explicit) | `html[data-palette='v'][data-theme='dark']` inside `@media screen` | (0,2,1) | Default `html[data-theme='dark']` (0,1,1); the theme's own light base by order in the file |
| Theme look rule | `html[data-palette='v'] X` | X + (0,1,1) | Default `X`. It ties with a default `html[data-theme='dark'] X`, which is why such selectors are tokenised instead (§1.5). |
| hljs | `html[data-palette] .hljs X` | X + (0,2,1) | Default `html[data-theme='dark'] X` = X + (0,1,1) |

**Every mode state.** The guard `:not([data-theme='light'])` is what lets the visitor's toggle override the OS:

| OS | Toggle (`data-theme`) | Theme block that applies |
|---|---|---|
| light | none (before hydration) | light base (0,2,1) |
| dark | none (before hydration) | OS-dark block (0,2,1), later in the file than the light base |
| any | `light` | explicit light (0,2,1). The OS-dark block is excluded by its guard. |
| any | `dark` | explicit dark (0,2,1). With OS dark, the OS-dark block also matches with the same values. |
| any, printing | any | light base (0,2,1): both dark blocks are `screen` only |

**Rules for theme files.** `scripts/check-themes.mjs` enforces all of them:

- Every selector starts with `html[data-palette='<name>']` (or `:where(html[data-palette])` / `html[data-palette]`
  in the shared files). There is no `:root`, no `@layer` (unlayered `globals.css` would beat a layered theme), and no
  `!important`.
- The blocks have exactly the selectors and `@media` preludes of the template above. Both mode blocks define every
  seed token (§2.2) and `color-scheme`. The two dark blocks are identical.
- Every token set in the light block is set in both dark blocks too. The light block's first selector,
  `html[data-palette='<name>'][data-palette]`, matches in every mode, so a token set only there would leak into dark.
  (A token set only in the dark blocks is fine: in light the base derivation applies.)
- A token is defined in only one section.
- Look rules never target a selector that `globals.css` also styles under `html[data-theme=…]`. The selectors with
  such a variant are: `.copy-button`, `.mermaid-tool-button`, `.hljs*`, `.security-gate-error`, `.admin-btn-danger`,
  `.admin-error-bar`, `.admin-status-bar`, `.sec-icon`, `.sgw-toggle-track` and `.sgw-toggle-label input:disabled + …`.
  Every colour on those selectors is reachable through a token instead.
- A theme never touches `opacity`, `pointer-events` or `display` on `.sgw-cookie-banner`, `.sgw-cookie-backdrop` or
  `.sgw-cookie-modal-bg`, and never renames a `sgw-*` class. The consent logic and `check-consent.mjs` depend on them.

### 1.5 How the default stays pixel-identical

The default is protected by four rules. Each one guarantees identity by construction:

1. **Substitution only.** In `globals.css` and in the JSX inline styles, a colour (or font stack, or radius) that a
   theme may change becomes `var(--new-token, <exactly what is there today>)`. For example, `color: #2da44e` becomes
   `color: var(--success, #2da44e)`, and `background: var(--surface-soft)` becomes
   `background: var(--nav-card-bg, var(--surface-soft))`. Inside `color-mix()` only the argument is wrapped:
   `color-mix(in srgb, var(--control-bg, #0d1117) 88%, transparent)`.
2. **New tokens are never defined outside `app/themes/`.** In the default every fallback applies. This includes the
   two tokens that are already referenced but never defined: `--danger` (`AdminSecurity.js:406`) and `--font-mono`
   (`globals.css:2468,2530`).
3. **No declaration is added to `globals.css`.** Styling the default lacks altogether goes into `app/themes/*.css`
   under `html[data-palette]`. Examples are heading colour, `::selection`, `color-scheme`, scrollbars, a generic focus
   ring and the gate button hover. Each substitution can use a fallback that differs per call site, because the
   default never defines the token. One token, for instance `--hover-bg`, can therefore replace `rgba(0,0,0,.06)`
   in one place and `rgba(127,127,127,.08)` in another.
4. **The default HTML is unchanged.** It has no `data-palette` attribute, and the Mermaid code keeps today's branch
   when no palette is set.

Rule 1 can be checked mechanically. Unwrap every `var(--new, X)` to `X` in the branch's `globals.css` and the result
must equal `main`'s file byte for byte (§5.2).

Two existing default quirks stay as they are, because requirement 1 is strict. Neither reaches a themed site:

- **E1, unguarded OS-dark rules.** With OS dark and the light toggle, these rules paint dark colours on light
  backgrounds: hljs (`globals.css:1355-1448`), checkbox hover (1669), gate error (1870), danger button (2128), admin
  bars (2188) and sec icons (2304). In a theme the leaking rules resolve to the theme's tokens for the current mode.
  Specifically, the tokenised rules read per-mode tokens, `hljs.css` out-ranks the hljs block, and `base.css`
  re-asserts the checkbox hover.
- **E2.** Explicit dark has no `.hljs-tag` rule, and the weight-600 keyword rules (1687-1694, 1753-1756) also apply in
  dark.

Fixing either in the default is a separate commit that needs Christian's approval (§6).

### 1.6 The shared layer, `app/themes/base.css`

**Role defaults.** A `:where(html[data-palette])` block derives every *role* token (§2.4) from the *seed* tokens
(§2.2). An example is `--nav-active-bg: var(--accent-soft)`. The block works for both modes:

- All tokens are declared on `<html>`, so `var()` resolves against `<html>`'s current values, which are those of the
  active mode.
- The block's specificity is (0,0,0), so any theme block overrides a default.
- None of these tokens exists in `globals.css`, so there is no tie with the default's (0,1,1) blocks.

A new theme therefore needs only its seeds, about 40 per mode, and overrides roles where the derived value is wrong.

**Rules only themes get.** Each rule reads tokens:

```css
html[data-palette] .markdown-body :is(h1, h2, h3, h4, h5, strong, b, summary, dt),
html[data-palette] .header-title { color: var(--text-strong); }
html[data-palette] ::selection { background-color: var(--selection-bg); }
html[data-palette] { scrollbar-color: var(--scrollbar-thumb) transparent; }
html[data-palette] :is(.sidebar, .markdown-body pre, .mermaid-chart, .markdown-body table) { scrollbar-width: thin; }
html[data-palette] :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
html[data-palette] :is(input:not([type='checkbox']), textarea, select):focus-visible { outline-offset: -1px; }
html[data-palette] .sgw-toggle-label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
html[data-palette] .security-gate-button:hover:not(:disabled) { background: var(--button-primary-hover-bg); }
html[data-palette] .markdown-body input[type='checkbox']:hover { background: var(--accent-soft); } /* neutralises E1 at 1669 */
```

- **Heading colour.** `h6` stays muted, as in the default. A heading's anchor and its links keep their own colour.
- **Generic focus ring.** The more specific default focus rules (copy button, checkbox) still win. They already read
  `--accent` through substitution.
- **Cookie toggle.** The default has no visible keyboard focus on the toggle, because the input is clipped. The
  label draws the ring instead: its own outline is not clipped by its own `overflow: hidden`.

### 1.7 highlight.js

`rehype-highlight` emits only `hljs` and `hljs-*` classes, and today every colour comes from three overlapping
blocks in `globals.css`. `app/themes/hljs.css` replaces all three for themed sites. It works as follows:

- The root is `html[data-palette] code.hljs`, which is (0,2,2). It beats the default's `html[data-theme='dark'] .hljs`,
  which is (0,2,1).
- **Every** selector in the three default blocks is mirrored as `html[data-palette] .hljs <selector>`. That always
  out-ranks the default's light form (X) and dark form (X + (0,1,1)) by at least (0,1,0). The deepest default selector,
  `html[data-theme='dark'] .hljs-title.class_.inherited__`, is (0,4,1); its mirror is (0,5,1). The lint checks that
  every hljs selector in `globals.css` has a mirror.
- Each rule reads one of 15 role tokens (§2.5). A theme only sets the `--hl-*` values for each mode. Font weights
  are reset to 400 through `var(--hl-keyword-weight, 400)`, except `section` (600), `strong` (700) and italic
  comments. This removes the default's weight-600 keywords.

### 1.8 Mermaid

Mermaid's dark palette is hard-coded in JavaScript (`MarkdownRenderer.js:256-281`), so CSS cannot reach it. The hook:

- **Without a palette, the code is unchanged.** It still uses `theme: isDark ? 'base' : 'default'` with today's
  `darkThemeVariables`.
- **With a palette**, it uses `theme: 'base'` and builds `themeVariables` for **both** modes, read when the chart
  renders:

  ```js
  const cs = getComputedStyle(document.documentElement)
  const v = (n) => cs.getPropertyValue(`--mermaid-${n}`).trim() || undefined
  themeVariables = {
    darkMode: isDark, fontFamily: v('font'), background: v('bg'),
    primaryColor: v('node-bg'), primaryBorderColor: v('node-border'), primaryTextColor: v('node-text'),
    secondaryColor: v('secondary-bg'), tertiaryColor: v('tertiary-bg'), lineColor: v('line'), textColor: v('text'),
    mainBkg: v('node-bg'), nodeBorder: v('node-border'), clusterBkg: v('cluster-bg'), clusterBorder: v('cluster-border'),
    edgeLabelBackground: v('bg'), noteBkgColor: v('note-bg'), noteTextColor: v('note-text'), noteBorderColor: v('note-border'),
    actorBkg: v('node-bg'), actorBorder: v('node-border'), actorTextColor: v('node-text'), actorLineColor: v('line'),
    signalColor: v('text'), signalTextColor: v('text'), labelBoxBkgColor: v('note-bg'), labelTextColor: v('text'),
    labelBoxBorderColor: v('node-border'), loopTextColor: v('text'),
    activationBkgColor: v('secondary-bg'), activationBorderColor: v('node-border'),
  }
  ```

- **Gantt and categorical colours.** The same object also maps the Gantt variables (task, active, done and critical
  bars, section bands, grid, today and vertical markers) and, when the theme sets `--mermaid-cat-0` … `-7` with
  `--mermaid-cat-ink`, the gitGraph branches, the timeline, mindmap and kanban sections, pie slices and xychart series
  (§2.6). Left to Mermaid, done bars are `lightgrey` and critical bars `red` under the theme's text colour (1.20:1
  and 2.23:1 in valley dark), and every branch and section is a gray derived from the node colour.
- **Mode changes.** The existing `mermaidThemeKey` (driven by `data-theme` and the media query) already re-renders
  the chart when the mode changes, and the values are read at that moment. No new observer is needed, because the
  palette never changes on the client.
- **Plain colours only.** Mermaid's colour maths (khroma) needs plain hex or rgb, so `--mermaid-*` must resolve to
  plain colours, never `color-mix()`. Custom-property computed values have `var()` substituted, so
  `getPropertyValue` returns the final hex even when `base.css` derives the value from a seed.
- **Containers** already use tokens: `.mermaid-chart` uses `--code-bg`, the toolbar uses `--code-header-bg` and the
  overlay uses `--surface`.

### 1.9 KaTeX, images, print

- **KaTeX** inherits `currentColor` and follows `--text`. Its fonts are its own, and `--font-sans` does not touch
  them. Error text (`errorColor`, default `#cc0000`, only on invalid TeX) is left alone.
- **Images** keep a transparent background over `--surface` and get the theme's hairline.
- **Print** uses the theme's light palette in every mode: both dark blocks are `@media screen` only, and the light
  base out-ranks the default's dark tokens (§1.4). A dark valley page therefore prints dark text with visible
  hairlines; with the dark palette, its white hairlines at 10% alpha would vanish on paper. Mermaid charts keep the
  colours they were rendered with. The default is unchanged: its only print rule hides the Cookie settings pill, and
  a dark default page prints its dark-mode colours.

### 1.10 Avoiding a flash, and known limits

- **The palette is never wrong on first paint.** `data-palette` is in the server HTML, and the theme CSS ships in
  render-blocking `<link rel="stylesheet">` tags in `<head>`, like `globals.css` (Next.js splits it over two of the
  page's three CSS files; the third is KaTeX's). Before hydration the mode follows the OS through the theme's guarded
  `@media (prefers-color-scheme: dark)` block, so a themed page paints correctly from the first frame.
- **The mode can flash, as today.** When a visitor's saved mode differs from the OS mode, the OS mode shows until
  `ThemeContext` hydrates. The fix is a small inline `<head>` script that sets `data-theme` before paint, plus
  `suppressHydrationWarning` on `<html>`. It would change the default's loading frames, so it is left for a separate
  decision (§6).
- **The 404 page bakes in the build-time config.** `/_not-found` is the only prerendered page, and it carries the
  theme as it was at build time, exactly as it already does for the GA ID. On Amplify S3 builds the build reads the
  config from S3, so the two usually match.
- **Config cache.** Changes take up to 60 seconds per instance. (Until the review round, a root
  `content-security.json` was read once per process and never again: a pre-existing bug in `loadConfig`'s in-flight
  promise, fixed separately in `lib/security.mjs`. S3 and the content provider were never affected.)

---

## 2. Tokens

Columns: **Default** is today's value; for new tokens it is the fallback each call site keeps, so the default stays
pixel-identical. **Valley dark** and **valley light** are the theme's values. Contrast ratios are WCAG 2.x, with alpha
composited over the named ground. They were computed with `.theme-review/contrast.mjs`; the full pair table is
§2.7.

### 2.1 Existing tokens (17). A theme must set every one in both modes.

| Token | Default light | Default dark | Valley dark | Valley light | Contrast (dark / light) |
|---|---|---|---|---|---|
| `--page-bg` | radial `#eef6ff→#fff` | radial `#0b1a2a→#090c12` | `#0d0d0d` | `#f3f2ee` | ground |
| `--surface` (header, card, gate, banner) | `#ffffff` | `#0f1722` | `#1a1a19` | `#fcfcfa` | ground |
| `--surface-soft` (pre, th, details, buttons) | `#f6f8fa` | `#111b29` | `#232322` | `#ecebe6` | ground |
| `--text` | `#1f2328` | `#e6edf3` | `#c3c2b7` | `#43423d` | 9.72 / 9.80 on card |
| `--muted` | `#57606a` | `#9ba7b4` | `#94928b` | `#64635d` | 5.59 / 5.87 on card; 5.05 / 5.05 on soft |
| `--border` | `#d0d7de` | `#2f3e52` | `rgba(255,255,255,.10)` | `rgba(26,26,25,.12)` | decorative (1.34 / 1.28) |
| `--border-strong` | `#b7c0c8` | `#4b6078` | `rgba(255,255,255,.36)` | `rgba(26,26,25,.50)` | 3.34 / 3.32 on card (checkbox) |
| `--link` | `#0969da` | `#78b7ff` | `#6da7ec` | `#256abf` | 6.96 / 5.25 on card; 6.28 / 4.52 on soft |
| `--shadow` (card, gate) | 2-layer `rgba(16,24,40,…)` | 2-layer `rgba(0,0,0,…)` | `inset 0 1px 0 rgba(255,255,255,.04), 0 1px 2px rgba(0,0,0,.35)` | `inset 0 1px 0 rgba(255,255,255,.6), 0 1px 2px rgba(26,26,25,.08)` | — |
| `--accent-soft` | `#eef6ff` | `#152436` | `rgba(57,135,229,.12)` | `rgba(57,135,229,.12)` | fill |
| `--mark-bg` | `#fff0b2` | `#614700` | `rgba(201,133,0,.35)` | `#efdebc` | |
| `--mark-text` | `#3f2d00` | `#fff4cc` | `#ffffff` | `#1a1a19` | 9.83 / 13.14 |
| `--code-inline-bg` | `#eff2f6` | `#161b22` | `#232322` | `#ecebe6` | |
| `--code-inline-border` | `#e3e8ee` | `#30363d` | `rgba(255,255,255,.10)` | `rgba(26,26,25,.12)` | decorative |
| `--code-bg` (the code well) | `#fafafa` | `#0d1117` | `#0d0d0d` | `#f3f2ee` | ground |
| `--code-border` | `#d0d7de` | `#30363d` | `rgba(255,255,255,.10)` | `rgba(26,26,25,.12)` | decorative |
| `--code-header-bg` | `#f0f2f4` | `#161b22` | `#171717` | `#eae9e5` | muted 5.76 / 4.96 on it |

**Valley's body text is analytics' secondary text (`#c3c2b7`), not white.** That is the Docs-tab idiom
(`.docs-p`, `dd`, the lede): prose in secondary, with headings, `strong`, `th` and the current nav item in
`--text-strong`.

### 2.2 New seed tokens. A theme must set every one in both modes.

| Token | Role | Default fallback(s) at the call sites | Valley dark | Valley light | Contrast (dark / light) |
|---|---|---|---|---|---|
| `--text-strong` | Headings, `strong`, `th`, current and hover nav, inline code | `var(--text)` (`globals.css:1809, 2654, 2804, 2891`); other uses only in `base.css` | `#ffffff` | `#1a1a19` | 17.42 / 16.96 on card |
| `--surface-hover` | Raised hover fill (analytics `#2f2f2d`) | only through roles | `#2f2f2d` | `#e3e2dc` | |
| `--link-hover` | Prose link hover | only in theme look rules | `#86b6ef` | `#1c5cab` | 8.25 / 6.45 on card |
| `--accent` | Focus ring, checkbox, current-nav bar, focused field border, toggle on | `var(--link)` (934, 1647, 1652-1653, 1665, 1839, 2002) | `#3987e5` | `#256abf` | ring 4.32–5.34 / 4.52–5.25 (needs 3:1) |
| `--accent-hover` | Primary fill hover | through roles | `#5598e7` | `#1c5cab` | |
| `--on-accent` | Text and icons on an accent fill | through roles | `#0d0d0d` | `#ffffff` | 5.34 / 5.39 on accent |
| `--success` | Copied state, green sec icon | `#2da44e` (959-960, 1044-1045, 2297); `#3fb950` (2301, 2305) | `#4cc79a` | `#0b7552` | 8.25 / 5.55 on card |
| `--danger` | Gate error, admin error, danger button, red sec icon | `#cf222e` (1862, 2109-2110, 2152, 2298, `AdminSettings.js:325`); `#ff7b72` (1867, 1872, 2119-2120, 2130-2131, 2302, 2306); `#c62828` (`AdminSecurity.js:406`, existing) | `#ef8a8a` | `#b42d2d` | 7.19 / 6.10 on card |
| `--hl-*` (15) | Syntax colours (§2.5) | none: `hljs.css` only | §2.5 | §2.5 | §2.7 |

In dark, white text on valley's `#3987e5` is 3.64:1, which fails AA. Valley therefore follows analytics' own
`.setup-pip` precedent and puts dark text on the accent.

### 2.3 Shape tokens: mode-independent and optional

| Token | Call sites | Default fallback | Valley |
|---|---|---|---|
| `--font-sans` | `body` (100) | `'IBM Plex Sans', 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif` | `system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` |
| `--font-mono` | 829, 875, 896; `kbd` 1230; admin 2468, 2530 (existing) | `'JetBrains Mono', 'Cascadia Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`. `kbd` keeps `'JetBrains Mono', 'Cascadia Mono', monospace` and admin keeps `monospace`. | `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace` |
| `--radius-card` | `.markdown-body` (648) | `14px` | `8px` |
| `--radius-card-compact` | `.markdown-body` at ≤768px (663) | `10px` | `8px` |
| `--radius-block` | pre 842, code block 859, mermaid loading 987, mermaid block 996, details 1252, mobile sidebar 471 | `10px` | `8px` |
| `--radius-panel` | mermaid overlay 1095 (`12px`), gate 1790 (`12px`), admin modal 2065 (`8px`) | as listed | `8px` |
| `--radius-pill` | TOC section header 332 and site-root chip 596 (`20px`), wizard badge 2562 (`99px`), Cookie settings 2726 (`999px`) | as listed | `999px` |

No web font is loaded, in the default or in valley. The CSP (`customHttp.yml`, `font-src 'self' data:`) would block
Google Fonts anyway. A brand font for sgwireless has to be self-hosted under `public/` with a licence that allows it.

### 2.4 Role tokens: derived in `base.css`, a theme may override

**Base** is the derivation in `:where(html[data-palette])`. **Valley** is shown only where it overrides the base.

| Token | Call sites (`globals.css`) | Default fallback | Base derivation | Valley dark | Valley light |
|---|---|---|---|---|---|
| `--code-inline-fg` | 826 | `var(--text)` | `var(--text-strong)` | | |
| `--blockquote-fg` | 1571 | `var(--muted)` | `var(--muted)` | `var(--text)` | `var(--text)` |
| `--blockquote-border` | 1572 | `var(--border)` | `var(--border)` | `#383835` | `#d4d3cd` |
| `--header-shadow` | 119 | `0 1px 3px rgba(16,24,40,.08)` | `none` | | |
| `--nav-card-bg` | toc-card 309, mobile sidebar 469 | `var(--surface-soft)` | `var(--surface-soft)` | `var(--surface)` | `var(--surface)` |
| `--nav-hover-fg` | 344, 366, 406, 537 (`var(--text)`); 429, 559, 601 (`var(--link)`) | as listed | `var(--text-strong)` | | |
| `--nav-hover-bg` | 430, 560 | `rgba(9,105,218,.05)` | `var(--hover-bg)` | `rgba(255,255,255,.04)` | `rgba(26,26,25,.04)` |
| `--nav-hover-border` | 431, 561 (`var(--link)`) | as listed | `var(--border-strong)` | `transparent` | `transparent` |
| `--chip-hover-border` | TOC section pill 345 (`var(--text)`), site-root chip 602 (`var(--link)`) | as listed | `var(--border-strong)` | | |
| `--nav-active-fg` | 435, 567 | `var(--link)` | `var(--text-strong)` | | |
| `--nav-active-bg` | 437, 569 | `rgba(9,105,218,.05)` | `var(--accent-soft)` | | |
| `--nav-active-border` | 436, 568 | `var(--link)` | `var(--accent)` | | |
| `--hover-bg` | 367 (`rgba(0,0,0,.06)`), 2356 (`rgba(127,127,127,.08)`), 2473 (`rgba(127,127,127,.05)`) | as listed | `color-mix(in srgb, var(--text-strong) 6%, transparent)` | `rgba(255,255,255,.05)` | `rgba(26,26,25,.05)` |
| `--control-bg` | header button 183, overlay close 1115, admin button 2015 (`var(--surface-soft)`); mermaid light 1016 (`var(--surface)` in the mix); mermaid dark 1460 (`#0d1117` in the mix) | as listed | `var(--surface-soft)` | | |
| `--control-border` | 181, 1113, 2013 (`var(--border)`); 1014 (`var(--border)` in the mix); 1461 (`#30363d` in the mix) | as listed | `var(--border)` | `rgba(255,255,255,.28)` | `rgba(26,26,25,.28)` |
| `--control-fg` | 184, 1017, 1116, 2016 (`var(--text)`); 1462 (`#c9d1d9`) | as listed | `var(--text)` | | |
| `--control-hover-bg` | 192 (`var(--surface)`); 924, 1126, 1455, 2029 (`var(--border)`); 1040 (`var(--surface)` 96% mix); 1466 (`#161b22` 92% mix) | as listed | `var(--surface-hover)` | | |
| `--control-hover-border` | 193, 1039 (`var(--link)`); 925 (`var(--code-border)`); 1127 (`var(--border-strong)`); 1467 (`#3b82f6`) | as listed | `var(--border-strong)` | `rgba(255,255,255,.5)` | `rgba(26,26,25,.5)` |
| `--control-hover-fg` | 194 (`var(--link)`); 926, 1456 (`var(--text)`) | as listed | `var(--text-strong)` | | |
| `--control-pressed-bg` | TOC button open 248 | `color-mix(in srgb, var(--link) 10%, var(--surface))` | `var(--accent-soft)` | `rgba(57,135,229,.16)` | |
| `--control-pressed-border` | 246 | `var(--link)` | `var(--accent)` | | |
| `--control-pressed-fg` | 247 | `var(--link)` | `var(--text-strong)` | | |
| `--field-bg` | gate input 1831 (`var(--surface-soft)`); admin input 1995 (`var(--surface)`) | as listed | `var(--surface-soft)` | | `#ffffff` |
| `--field-border` | 1829, 1992 | `var(--border)` | `var(--border-strong)` | | |
| `--placeholder` | `base.css` only (`::placeholder`, opacity 1) | — (the browser's grey, 3.41 on valley's dark field) | `var(--muted)` | (5.05 on field) | (6.03 on field) |
| `--focus-ring-shadow` | admin input focus 2003 | `0 0 0 3px rgba(9,105,218,.15)` | `none` (the generic ring replaces it) | | |
| `--button-primary-bg` | gate 1844; admin primary 2097, 2098 | `var(--link)` | `var(--accent)` | | |
| `--button-primary-fg` | 1845, 2099 | `#fff` | `var(--on-accent)` | | |
| `--button-primary-hover-bg` | 2104; gate hover in `base.css` | `var(--link)` | `var(--accent-hover)` | | |
| `--button-primary-hover-opacity` | 2103 | `0.88` | `1` | | |
| `--danger-hover-bg` | 2114 (`#cf222e`); 2124, 2134 (`#ff7b72`) | as listed | `color-mix(in srgb, var(--danger) 14%, transparent)` | `rgba(230,103,103,.16)` | `rgba(230,103,103,.10)` |
| `--danger-hover-fg` | 2115 (`#fff`); 2125, 2135 (`#0d1117`) | as listed | `var(--danger)` | | |
| `--danger-bg` / `--danger-border` / `--danger-fg` | error bar 2165-2167 (`#fff0f0`/`#ffcdd2`/`#b71c1c`); 2177-2179 and 2190-2192 (`#2a0a0a`/`#5a1a1a`/`#ff7b72`) | as listed | `color-mix(var(--danger) 12%)` / `… 45%` / `var(--danger)` | `rgba(230,103,103,.12)` / `rgba(230,103,103,.45)` / – | `rgba(230,103,103,.10)` / `rgba(180,45,45,.35)` / – |
| `--success-bg` / `--success-border` / `--success-fg` | status bar 2171-2173 (`#e8f5e9`/`#c8e6c9`/`#1b5e20`); 2183-2185 and 2195-2197 (`#0a2a0a`/`#1a5a1a`/`#7ee787`) | as listed | `color-mix(var(--success) 12%)` / `… 45%` / `var(--success)` | `rgba(25,158,112,.14)` / `rgba(25,158,112,.45)` / – | `rgba(25,158,112,.10)` / `rgba(11,117,82,.35)` / – |
| `--backdrop` | mermaid overlay 1072 (`.7`), admin modal 2054 (`.6`), cookie backdrop 2606 (`.5`), cookie modal 2753 (`.6`), all `rgba(0,0,0,…)` | as listed | `rgba(0,0,0,.6)` | | `rgba(26,26,25,.45)` |
| `--backdrop-soft` | TOC drawer 491 | `rgba(0,0,0,.25)` | `rgba(0,0,0,.3)` | `rgba(0,0,0,.4)` | `rgba(26,26,25,.2)` |
| `--overlay-shadow` | mobile sidebar 473, mermaid overlay 1098, admin modal 2066 | as listed | `0 8px 24px rgba(0,0,0,.35)` | | `0 8px 24px rgba(26,26,25,.12)` |
| `--table-head-bg` / `--table-head-fg` | 1600 / 1601 | `var(--surface-soft)` / `var(--text)` | `var(--surface-soft)` / `var(--text-strong)` | | |
| `--table-row-bg` / `--table-row-alt-bg` | 1611 / 1616 | `var(--surface)` / `var(--surface-soft)` | both `var(--surface)` (no zebra) | | |
| `--consent-accent` | 2671, 2694, 2696, 2733, 2736, 2920, 2922 | `#fb6362` | `var(--accent)` | | |
| `--consent-accent-hover` | Accept and Save hover: bg 2699, 2929 (`transparent`), border 2700, 2930 (`#fb6362`) | as listed | `var(--accent-hover)` | | |
| `--consent-on-accent` | 2695, 2921 | `#000` | `var(--on-accent)` | | |
| `--consent-outline-border` | Reject 2706 | `#fb6362` | `var(--border-strong)` | | |
| `--consent-outline-hover-bg` / `-fg` | 2709 / 2710 | `#fb6362` / `#000` | `var(--surface-hover)` / `var(--text-strong)` | | |
| `--toggle-track-bg` | 2850 (`#fff`); 2903 (`var(--surface-soft)`) | as listed | `var(--surface-soft)` | | |
| `--toggle-track-border` | 2851 (`#d3d3d3`); 2904 (`var(--border)`) | as listed | `var(--border-strong)` | | |
| `--toggle-knob` | 2861 (`#d3d3d3`); 2907 (`var(--muted)`) | as listed | `var(--muted)` | | |
| `--toggle-on-bg` | 2868, 2869 | `#3faa9c` | `var(--accent)` | | |
| `--toggle-on-knob` | 2873 | `#fff` | `var(--on-accent)` | | |
| `--toggle-disabled-bg` | 2876-2877 (`#d3d3d3`); 2910-2911 (`var(--border)`) | as listed | `var(--surface-hover)` | | |
| `--toggle-disabled-knob` | 2881 | `#fff` | `var(--muted)` | | |
| `--selection-bg` | `base.css` only; opaque, so the pair below holds over any fill | — | `color-mix(in srgb, var(--accent) 35%, var(--surface))` | `#254060` | `#d1e2f5` |
| `--selection-fg` | `base.css` only: selected text takes it, so muted text, links, syntax comments and labels on buttons and diagram fills stay readable | — | `var(--text-strong)` | (10.60) | (13.19) |
| `--scrollbar-thumb` | `base.css` only | — | `var(--border-strong)` | `#7a7872` (4.40 page / 3.95 card) | `#86857e` (3.31 / 3.61) |

**What this means for the cookie banner in valley.** Accept is the primary button: accent fill with dark text in
dark mode, white text in light. Reject is a neutral tool button with a strong border. Cookie settings is a pill.
Banner geometry, classes and visibility rules are untouched.

### 2.5 Syntax tokens (`hljs.css`). A theme sets all 15 in both modes.

| Token | hljs classes (every default selector is mirrored) | Default today (light / dark), for reference | Valley dark | Valley light | Contrast on well (dark / light) |
|---|---|---|---|---|---|
| `--hl-fg` | `code.hljs`, `subst`, `emphasis` (italic), `strong` (700), `operator`, `punctuation` | `#24292e` / `#c9d1d9` | `#c3c2b7` | `#43423d` | 10.85 / 8.99 |
| `--hl-keyword` | `keyword`, `doctag`, `template-tag`, `meta .hljs-keyword`, `variable.language_` | `#d73a49` / `#ff7b72` | `#a99ff0` | `#5a4bc4` | 8.24 / 5.79 |
| `--hl-title` | `title`, `title.function_`, `function .hljs-title`, `selector-id` | `#d73a49` 600 (block 2) or `#6f42c1` / `#d2a8ff` | `#6da7ec` | `#1c5cab` | 7.76 / 5.92 |
| `--hl-type` | `type`, `title.class_`, `title.class_.inherited__`, `class .hljs-title`, `built_in`, `builtin`, `builtin-name` | `#6f42c1`, `#005cc5` / `#ffa657`, `#d2a8ff` | `#e683a8` | `#b0306a` | 7.57 / 5.39 |
| `--hl-attr` | `attr`, `attribute`, `variable`, `template-variable`, `property`, `selector-class`, `selector-attr`, `selector-pseudo`, `tag .hljs-attr` | `#6f42c1`, `#005cc5` / `#79c0ff` | `#ec8a5e` | `#b24418` | 7.74 / 5.02 |
| `--hl-string` | `string`, `regexp`, `meta .hljs-string` | `#032f62` / `#a5d6ff` | `#4cc79a` | `#0b7552` | 9.20 / 5.09 |
| `--hl-constant` | `number`, `literal`, `symbol`, `bullet`, `link` | `#005cc5`, `#e36209` / `#79c0ff`, `#f2cc60` | `#e5a50a` (analytics' code colour) | `#8a5a00` | 8.99 / 5.29 |
| `--hl-comment` | `comment`, `quote` (italic), `code`, `formula` | `#6a737d` / `#8b949e` | `#94928b` | `#64635d` | 6.24 / 5.38 |
| `--hl-meta` | `meta` | `#735c0f` 600 / `#79c0ff` | `#a99ff0` | `#5a4bc4` | 8.24 / 5.79 |
| `--hl-tag` | `tag`, `name`, `selector-tag` | `#22863a` / `#7ee787` | `#6da7ec` | `#1c5cab` | 7.76 / 5.92 |
| `--hl-section` | `section` (600) | `#d73a49` 600 / `#1f6feb` 700 | `#6da7ec` | `#1c5cab` | 7.76 / 5.92 |
| `--hl-add-fg` / `--hl-add-bg` | `addition` | `#22863a` on `#e6ffed` / `#aff5b4` on `#033a16` | `#4cc79a` on `rgba(25,158,112,.14)` | `#096a49` on `rgba(25,158,112,.12)` | 7.91 / 5.22 |
| `--hl-del-fg` / `--hl-del-bg` | `deletion` | `#b31d28` on `#ffeef0` / `#ffdcd7` on `#67060c` | `#ef8a8a` on `rgba(230,103,103,.12)` | `#b42d2d` on `rgba(230,103,103,.10)` | 7.06 / 5.06 |

Valley uses seven hues, all from analytics' palette (`palette.ts` SERIES, lightened where needed for AA as text):
violet, blue, magenta, orange, aqua, amber and gray.

### 2.6 Mermaid tokens: plain hex, read by JavaScript

| Token | Base derivation | Valley dark | Valley light | Mermaid variables |
|---|---|---|---|---|
| `--mermaid-font` | `var(--font-sans)` | system-ui stack | same | `fontFamily` |
| `--mermaid-bg` | `var(--code-bg)` | `#0d0d0d` | `#f3f2ee` | `background`, `edgeLabelBackground` |
| `--mermaid-node-bg` | `var(--surface-soft)` | `#232322` | `#fcfcfa` | `primaryColor`, `mainBkg`, `actorBkg` |
| `--mermaid-node-border` | `var(--muted)` | `#7a7872` (4.40 on bg) | `#8a8982` (3.13) | `primaryBorderColor`, `nodeBorder`, `actorBorder`, `labelBoxBorderColor`, `activationBorderColor` |
| `--mermaid-node-text` | `var(--text-strong)` | `#ffffff` (15.73) | `#1a1a19` (16.96) | `primaryTextColor`, `actorTextColor` |
| `--mermaid-line` | `var(--muted)` | `#94928b` (6.24) | `#64635d` (5.38) | `lineColor`, `actorLineColor` |
| `--mermaid-text` | `var(--text)` | `#c3c2b7` (10.85) | `#43423d` (8.99) | `textColor`, `signalColor`, `signalTextColor`, `labelTextColor`, `loopTextColor` |
| `--mermaid-secondary-bg` | `var(--surface)` | `#1a1a19` | `#ecebe6` | `secondaryColor`, `activationBkgColor` |
| `--mermaid-tertiary-bg` | `var(--surface-hover)` | `#2f2f2d` | `#e3e2dc` | `tertiaryColor` |
| `--mermaid-note-bg` / `-text` / `-border` | `var(--surface-hover)` / `var(--text-strong)` / `var(--muted)` | `#2f2f2d` / `#ffffff` (13.42) / `#7a7872` | `#efdebc` / `#1a1a19` (13.14) / `#8a8982` | `noteBkgColor`, `labelBoxBkgColor` / `noteTextColor` / `noteBorderColor` |
| `--mermaid-cluster-bg` / `-border` | `var(--surface)` / `var(--muted)` | `#1a1a19` / `#7a7872` (4.40 on bg, 3.95 on group) | `#ecebe6` / `#86857e` (3.31 / 3.10) | `clusterBkg` / `clusterBorder` |
| `--mermaid-link` | `var(--link)` | | | `taskTextClickableColor`, `vertLineColor` |
| `--mermaid-task-bg` / `-border` / `-text` | `var(--surface-soft)` / `var(--accent)` / `var(--text-strong)` | | | Gantt `taskBkgColor` / `taskBorderColor` / `taskTextColor`, `taskTextLightColor`, `taskTextDarkColor` (every bar's label) |
| `--mermaid-active-bg` / `-border` | `var(--surface-hover)` / `var(--accent-hover)` | `#192f49` (13.60) | `#d9e7f6` (13.86) | `activeTaskBkgColor` / `activeTaskBorderColor` |
| `--mermaid-done-bg` / `-border` | `var(--surface)` / `var(--muted)` | | | `doneTaskBkgColor` / `doneTaskBorderColor` |
| `--mermaid-crit-bg` / `-border` | `var(--surface-soft)` / `var(--danger)` | `#3f2929` (13.46) | `#f8dedd` (13.67) | `critBkgColor` / `critBorderColor`, `todayLineColor` |
| `--mermaid-section-bg` / `-bg-2` / `-alt-bg` | `var(--muted)` / `var(--accent)` / `var(--surface-hover)` | | | Gantt section bands (drawn at 20% opacity) |
| `--mermaid-grid` | `var(--muted)` | | | `gridColor` |
| `--mermaid-cat-0` … `-7`, `--mermaid-cat-ink` | none (optional; all nine or none) | analytics' SERIES, green lifted to `#009000`; ink `#0d0d0d` (4.62–6.33) | SERIES darkened (`#256abf` … `#dd3030`); ink `#ffffff` (4.61–5.25) | `git0-7` with `gitBranchLabel0-7` (gitGraph, mindmap root), `cScale0-11` with `cScaleLabel0-11` (timeline, mindmap, kanban), `pie1-8` with `pieSectionTextColor` (opacity 1), `xyChart.plotColorPalette` |

Without a theme's categorical colours Mermaid derives them from the node colour, which on a gray palette makes every
branch, section and slice the same gray with labels under 4.5:1. `taskTextOutsideColor` is `--mermaid-text`,
`excludeBkgColor` is `--mermaid-secondary-bg` and `titleColor` is `--mermaid-node-text`. `xyChart` is passed whole
(background, title, axis and label colours from the tokens above), because Mermaid merges it over the default
theme's light values. With a theme, Mermaid also gets `themeCSS: '.eventWrapper { filter: none; }'`: it brightens timeline
events by 20%, which took white labels on the light categories down to about 4:1.

The values follow analytics' diagram idiom (`DocsDiagrams.tsx:75-92`): raised nodes, a quiet stroke and primary text.

### 2.7 Contrast: every valley pair

AA requires 4.5:1 for text, and 3:1 for UI parts and the graphical objects needed to understand them (WCAG 2.2
1.4.3 and 1.4.11). The pairs marked **decorative** carry no information on their own. Prose links are underlined
because link and body text differ by only 1.40 (dark) and 1.87 (light), short of the 3:1 that 1.4.1 asks for when
colour alone marks a link. All pairs pass. Regenerate the table with
`node .theme-review/contrast.mjs --combined`; after implementation, `scripts/check-themes.mjs --contrast` measures
the same pairs in the browser (§5.4).

| Pair | Dark fg / bg | Dark | Light fg / bg | Light | Needs |
|---|---|---|---|---|---|
| Body text `--text` on page | `#c3c2b7` / `#0d0d0d` | 10.85 | `#43423d` / `#f3f2ee` | 8.99 | 4.5:1 |
| Body text `--text` on card `--surface` | `#c3c2b7` / `#1a1a19` | 9.72 | `#43423d` / `#fcfcfa` | 9.80 | 4.5:1 |
| Body text `--text` on `--surface-soft` (pre, th, details) | `#c3c2b7` / `#232322` | 8.78 | `#43423d` / `#ecebe6` | 8.44 | 4.5:1 |
| Headings `--text-strong` on `--surface` | `#ffffff` / `#1a1a19` | 17.42 | `#1a1a19` / `#fcfcfa` | 16.96 | 4.5:1 |
| `--text-strong` on `--surface-soft` | `#ffffff` / `#232322` | 15.73 | `#1a1a19` / `#ecebe6` | 14.59 | 4.5:1 |
| `--muted` on page | `#94928b` / `#0d0d0d` | 6.24 | `#64635d` / `#f3f2ee` | 5.38 | 4.5:1 |
| `--muted` on `--surface` | `#94928b` / `#1a1a19` | 5.59 | `#64635d` / `#fcfcfa` | 5.87 | 4.5:1 |
| `--muted` on `--surface-soft` | `#94928b` / `#232322` | 5.05 | `#64635d` / `#ecebe6` | 5.05 | 4.5:1 |
| `--muted` (code-lang) on `--code-header-bg` | `#94928b` / `#171717` | 5.76 | `#64635d` / `#eae9e5` | 4.96 | 4.5:1 |
| `--link` on `--surface` | `#6da7ec` / `#1a1a19` | 6.96 | `#256abf` / `#fcfcfa` | 5.25 | 4.5:1 |
| `--link` on `--surface-soft` | `#6da7ec` / `#232322` | 6.28 | `#256abf` / `#ecebe6` | 4.52 | 4.5:1 |
| `--link` on page | `#6da7ec` / `#0d0d0d` | 7.76 | `#256abf` / `#f3f2ee` | 4.82 | 4.5:1 |
| `--link-hover` on `--surface` | `#86b6ef` / `#1a1a19` | 8.25 | `#1c5cab` / `#fcfcfa` | 6.45 | 4.5:1 |
| `--link` vs `--text` (met by the underline, not by colour) | `#6da7ec` / `#c3c2b7` | 1.40 | `#256abf` / `#43423d` | 1.87 | decorative |
| Inline code `--code-inline-fg` on `--code-inline-bg` | `#ffffff` / `#232322` | 15.73 | `#1a1a19` / `#ecebe6` | 14.59 | 4.5:1 |
| `--mark-text` on `--mark-bg` over card | `#ffffff` / `#573f10` | 9.83 | `#1a1a19` / `#efdebc` | 13.14 | 4.5:1 |
| Selected text `--selection-fg` on `--selection-bg` (opaque, so on every ground) | `#ffffff` / `#254060` | 10.60 | `#1a1a19` / `#d1e2f5` | 13.19 | 4.5:1 |
| Primary button `--on-accent` on `--accent` | `#0d0d0d` / `#3987e5` | 5.34 | `#ffffff` / `#256abf` | 5.39 | 4.5:1 |
| Primary button hover `--on-accent` on `--accent-hover` | `#0d0d0d` / `#5598e7` | 6.51 | `#ffffff` / `#1c5cab` | 6.63 | 4.5:1 |
| `--success` on `--surface` | `#4cc79a` / `#1a1a19` | 8.25 | `#0b7552` / `#fcfcfa` | 5.55 | 4.5:1 |
| `--danger` on `--surface` | `#ef8a8a` / `#1a1a19` | 7.19 | `#b42d2d` / `#fcfcfa` | 6.10 | 4.5:1 |
| `--danger` on `--surface-soft` | `#ef8a8a` / `#232322` | 6.50 | `#b42d2d` / `#ecebe6` | 5.25 | 4.5:1 |
| Error bar `--danger-fg` on `--danger-bg` over card | `#ef8a8a` / `#322322` | 6.17 | `#b42d2d` / `#faedeb` | 5.48 | 4.5:1 |
| Status bar `--success-fg` on `--success-bg` over card | `#4cc79a` / `#1a2c25` | 6.91 | `#0b7552` / `#e5f3ec` | 4.98 | 4.5:1 |
| Danger button hover `--danger-hover-fg` on `--danger-hover-bg` over card | `#ef8a8a` / `#3b2625` | 5.81 | `#b42d2d` / `#faedeb` | 5.48 | 4.5:1 |
| Nav rest `--text` on `--nav-card-bg` | `#c3c2b7` / `#1a1a19` | 9.72 | `#43423d` / `#fcfcfa` | 9.80 | 4.5:1 |
| Nav hover `--nav-hover-fg` on `--nav-hover-bg` over card | `#ffffff` / `#232322` | 15.70 | `#1a1a19` / `#f3f3f1` | 15.67 | 4.5:1 |
| Nav current `--nav-active-fg` on `--nav-active-bg` over card | `#ffffff` / `#1e2731` | 15.10 | `#1a1a19` / `#e5eef7` | 14.84 | 4.5:1 |
| Header button icon `--control-fg` on `--control-bg` | `#c3c2b7` / `#232322` | 8.78 | `#43423d` / `#ecebe6` | 8.44 | 4.5:1 |
| Header button hover `--control-hover-fg` on `--control-hover-bg` | `#ffffff` / `#2f2f2d` | 13.42 | `#1a1a19` / `#e3e2dc` | 13.42 | 4.5:1 |
| TOC button pressed `--control-pressed-fg` on `--control-pressed-bg` over header | `#ffffff` / `#1f2b3a` | 14.28 | `#1a1a19` / `#e5eef7` | 14.84 | 4.5:1 |
| Admin button `--control-fg` on `--control-hover-bg` | `#c3c2b7` / `#2f2f2d` | 7.49 | `#43423d` / `#e3e2dc` | 7.76 | 4.5:1 |
| Field text `--text` on `--field-bg` | `#c3c2b7` / `#232322` | 8.78 | `#43423d` / `#ffffff` | 10.07 | 4.5:1 |
| Placeholder `--placeholder` on `--field-bg` | `#94928b` / `#232322` | 5.05 | `#64635d` / `#ffffff` | 6.03 | 4.5:1 |
| Table head `--table-head-fg` on `--table-head-bg` | `#ffffff` / `#232322` | 15.73 | `#1a1a19` / `#ecebe6` | 14.59 | 4.5:1 |
| Table cell `--text` on row hover over card | `#c3c2b7` / `#252525` | 8.51 | `#43423d` / `#f1f1ef` | 8.88 | 4.5:1 |
| Blockquote `--blockquote-fg` on card | `#c3c2b7` / `#1a1a19` | 9.72 | `#43423d` / `#fcfcfa` | 9.80 | 4.5:1 |
| Cookie Reject hover `--consent-outline-hover-fg` on `--consent-outline-hover-bg` | `#ffffff` / `#2f2f2d` | 13.42 | `#1a1a19` / `#e3e2dc` | 13.42 | 4.5:1 |
| Cookie banner link hover `--consent-accent` on card | `#3987e5` / `#1a1a19` | 4.79 | `#256abf` / `#fcfcfa` | 5.25 | 4.5:1 |
| Code `--hl-fg` on `--code-bg` | `#c3c2b7` / `#0d0d0d` | 10.85 | `#43423d` / `#f3f2ee` | 8.99 | 4.5:1 |
| Syntax `--hl-keyword` on `--code-bg` | `#a99ff0` / `#0d0d0d` | 8.24 | `#5a4bc4` / `#f3f2ee` | 5.79 | 4.5:1 |
| Syntax `--hl-title` on `--code-bg` | `#6da7ec` / `#0d0d0d` | 7.76 | `#1c5cab` / `#f3f2ee` | 5.92 | 4.5:1 |
| Syntax `--hl-type` on `--code-bg` | `#e683a8` / `#0d0d0d` | 7.57 | `#b0306a` / `#f3f2ee` | 5.39 | 4.5:1 |
| Syntax `--hl-attr` on `--code-bg` | `#ec8a5e` / `#0d0d0d` | 7.74 | `#b24418` / `#f3f2ee` | 5.02 | 4.5:1 |
| Syntax `--hl-string` on `--code-bg` | `#4cc79a` / `#0d0d0d` | 9.20 | `#0b7552` / `#f3f2ee` | 5.09 | 4.5:1 |
| Syntax `--hl-constant` on `--code-bg` | `#e5a50a` / `#0d0d0d` | 8.99 | `#8a5a00` / `#f3f2ee` | 5.29 | 4.5:1 |
| Syntax `--hl-comment` on `--code-bg` | `#94928b` / `#0d0d0d` | 6.24 | `#64635d` / `#f3f2ee` | 5.38 | 4.5:1 |
| Syntax `--hl-meta` on `--code-bg` | `#a99ff0` / `#0d0d0d` | 8.24 | `#5a4bc4` / `#f3f2ee` | 5.79 | 4.5:1 |
| Syntax `--hl-tag` on `--code-bg` | `#6da7ec` / `#0d0d0d` | 7.76 | `#1c5cab` / `#f3f2ee` | 5.92 | 4.5:1 |
| Syntax `--hl-section` on `--code-bg` | `#6da7ec` / `#0d0d0d` | 7.76 | `#1c5cab` / `#f3f2ee` | 5.92 | 4.5:1 |
| Syntax `--hl-keyword` on a bare `pre` (`--surface-soft`) | `#a99ff0` / `#232322` | 6.67 | `#5a4bc4` / `#ecebe6` | 5.43 | 4.5:1 |
| Syntax `--hl-comment` on a bare `pre` (`--surface-soft`) | `#94928b` / `#232322` | 5.05 | `#64635d` / `#ecebe6` | 5.05 | 4.5:1 |
| Diff `--hl-add-fg` on `--hl-add-bg` over well | `#4cc79a` / `#0f211b` | 7.91 | `#096a49` / `#d9e8df` | 5.22 | 4.5:1 |
| Diff `--hl-del-fg` on `--hl-del-bg` over well | `#ef8a8a` / `#271818` | 7.06 | `#b42d2d` / `#f2e4e1` | 5.06 | 4.5:1 |
| Mermaid node text on node fill | `#ffffff` / `#232322` | 15.73 | `#1a1a19` / `#fcfcfa` | 16.96 | 4.5:1 |
| Mermaid edge label `--mermaid-text` on chart bg | `#c3c2b7` / `#0d0d0d` | 10.85 | `#43423d` / `#f3f2ee` | 8.99 | 4.5:1 |
| Mermaid note text on note fill | `#ffffff` / `#2f2f2d` | 13.42 | `#1a1a19` / `#efdebc` | 13.14 | 4.5:1 |
| Gantt bar label `--mermaid-task-text` on task / active / done / critical fill | `#ffffff` / `#232322`, `#192f49`, `#1a1a19`, `#3f2929` | 15.73 / 13.60 / 17.42 / 13.46 | `#1a1a19` / `#ecebe6`, `#d9e7f6`, `#fcfcfa`, `#f8dedd` | 14.59 / 13.86 / 16.96 / 13.67 | 4.5:1 |
| Gantt marker text `--mermaid-link` on chart bg | `#6da7ec` / `#0d0d0d` | 7.76 | `#256abf` / `#f3f2ee` | 4.82 | 4.5:1 |
| Mermaid category label `--mermaid-cat-ink` on `--mermaid-cat-0…7` (lowest: green) | `#0d0d0d` / `#009000` | 4.62–6.33 | `#ffffff` / `#a06a00`, `#7162e3` | 4.61–5.25 | 4.5:1 |
| Focus ring `--accent` vs page | `#3987e5` / `#0d0d0d` | 5.34 | `#256abf` / `#f3f2ee` | 4.82 | 3:1 |
| Focus ring `--accent` vs `--surface` | `#3987e5` / `#1a1a19` | 4.79 | `#256abf` / `#fcfcfa` | 5.25 | 3:1 |
| Focus ring `--accent` vs `--surface-soft` | `#3987e5` / `#232322` | 4.32 | `#256abf` / `#ecebe6` | 4.52 | 3:1 |
| Field border `--field-border` vs card | `#6c6c6c` / `#1a1a19` | 3.34 | `#8b8b8a` / `#fcfcfa` | 3.32 | 3:1 |
| Field border `--field-border` vs `--field-bg` | `#727272` / `#232322` | 3.28 | `#8d8d8c` / `#ffffff` | 3.34 | 3:1 |
| Checkbox border `--border-strong` vs card | `#6c6c6c` / `#1a1a19` | 3.34 | `#8b8b8a` / `#fcfcfa` | 3.32 | 3:1 |
| Checkbox checked fill `--accent` vs card | `#3987e5` / `#1a1a19` | 4.79 | `#256abf` / `#fcfcfa` | 5.25 | 3:1 |
| Checkbox tick (white SVG, unchanged) on `--accent` | `#ffffff` / `#3987e5` | 3.64 | `#ffffff` / `#256abf` | 5.39 | 3:1 |
| Toggle off: track border vs modal (`--surface`) | `#6c6c6c` / `#1a1a19` | 3.34 | `#8b8b8a` / `#fcfcfa` | 3.32 | 3:1 |
| Toggle off: knob `--toggle-knob` on track | `#94928b` / `#232322` | 5.05 | `#64635d` / `#ecebe6` | 5.05 | 3:1 |
| Toggle on: track `--toggle-on-bg` vs modal | `#3987e5` / `#1a1a19` | 4.79 | `#256abf` / `#fcfcfa` | 5.25 | 3:1 |
| Toggle on: knob `--toggle-on-knob` on track | `#0d0d0d` / `#3987e5` | 5.34 | `#ffffff` / `#256abf` | 5.39 | 3:1 |
| Nav current marker `--nav-active-border` vs card | `#3987e5` / `#1a1a19` | 4.79 | `#256abf` / `#fcfcfa` | 5.25 | 3:1 |
| Mermaid node border vs chart bg | `#7a7872` / `#0d0d0d` | 4.40 | `#8a8982` / `#f3f2ee` | 3.13 | 3:1 |
| Mermaid line `--mermaid-line` vs chart bg | `#94928b` / `#0d0d0d` | 6.24 | `#64635d` / `#f3f2ee` | 5.38 | 3:1 |
| Mermaid group border `--mermaid-cluster-border` vs chart bg / group fill | `#7a7872` / `#0d0d0d`, `#1a1a19` | 4.40 / 3.95 | `#86857e` / `#f3f2ee`, `#ecebe6` | 3.31 / 3.10 | 3:1 |
| Gantt bar borders (task, active, done, critical) vs chart bg | `#3987e5`, `#5598e7`, `#94928b`, `#ef8a8a` / `#0d0d0d` | 5.34–8.03 | `#256abf`, `#1c5cab`, `#64635d`, `#b42d2d` / `#f3f2ee` | 4.82–5.92 | 3:1 |
| Mermaid categories `--mermaid-cat-0…7` vs chart bg (branch lines, edges) | SERIES / `#0d0d0d` | 4.62–6.33 | darkened SERIES / `#f3f2ee` | 4.11–4.41 | 3:1 |
| Prose link underline (80% of `--link`) vs card / page | `#5c8bc2` / `#1a1a19`, `#0d0d0d` | 4.92 / 5.28 | `#5087cb` / `#fcfcfa`, `#f3f2ee` | 3.61 / 3.40 | 3:1 |
| Admin selected tab outline `--border-strong` vs card | `#6c6c6c` / `#1a1a19` | 3.32 | `#8b8b8a` / `#fcfcfa` | 3.32 | 3:1 |
| Scrollbar thumb `--scrollbar-thumb` vs page / card | `#7a7872` / `#0d0d0d`, `#1a1a19` | 4.40 / 3.95 | `#86857e` / `#f3f2ee`, `#fcfcfa` | 3.31 / 3.61 | 3:1 |
| Hairline `--border` vs card | `#313130` / `#1a1a19` | 1.34 | `#e1e1df` / `#fcfcfa` | 1.28 | decorative |
| Header button border vs header (the icon identifies the button, at 8.78 / 8.44) | `#5a5a59` / `#1a1a19` | 2.53 | `#bdbdbb` / `#fcfcfa` | 1.84 | decorative |
| Blockquote bar vs card | `#383835` / `#1a1a19` | 1.48 | `#d4d3cd` / `#fcfcfa` | 1.46 | decorative |
| Disabled toggle knob on track (disabled controls are exempt) | `#94928b` / `#2f2f2d` | 4.31 | `#64635d` / `#e3e2dc` | 4.64 | decorative |

---

## 3. Look and feel beyond colour (valley)

Valley's character comes from analytics' **dashboard** (`analytics.css`), not from the warmer start page
(`intro.css`). The start page contributes only three idioms: underlined prose links, the double focus ring on fills,
and forced-colours care. Each delta below is either a token value (§2) or a look rule in valley's section 4. Every
look rule targets a selector with no `html[data-theme=…]` variant in the default.

| Area | Default today | Valley | How | Components touched |
|---|---|---|---|---|
| Page ground | radial gradient | flat `#0d0d0d` / `#f3f2ee` (analytics `--plane`) | token | `body` |
| Surfaces | card with a 2-layer drop shadow | flat panel: hairline, inset top highlight, 1px shadow (analytics `.panel`) | `--shadow` | `.markdown-body`, `.security-gate` |
| Header | `--surface` plus a drop shadow | flat `--surface` with a hairline bottom and no shadow (analytics `App.tsx:246`) | `--header-shadow: none` | `.app-header` |
| Header buttons | soft fill, hover turns blue | tool button: raised fill, `.28` white border; hover `#2f2f2d` with a `.5` border and white icon; TOC toggle when open = accent border plus 16% accent tint | `--control-*` | `.header-button`, `.toc-toggle-button` |
| Sidebar cards | `--surface-soft` cards | `--surface` panels like analytics' sidebar | `--nav-card-bg` | `.toc-card`, mobile `.sidebar` |
| TOC and site-map items | blue text plus a 5% blue tint on hover and current | rail idiom (`.docs-rail`): secondary text at rest; hover → white plus a `.04` tint; current → white, 2px accent bar, 12% accent tint, radius `0 6px 6px 0` | `--nav-*` tokens + look rule `:is(.toc-link, .sitemap-link) { border-radius: 0 6px 6px 0 }` | `.toc-link`, `.sitemap-link`, `.toc-section-header`, `.sitemap-siteroot-chip`, toggles |
| Type | IBM Plex Sans / JetBrains Mono (neither loaded); buttons and fields in the browser's control font | `system-ui` / `ui-monospace` stacks, no font request; buttons and fields inherit the page font, as analytics' `font: inherit` | `--font-sans`, `--font-mono`; `base.css` sets `font-family: inherit` on `button`, `input`, `select`, `textarea` at (0,0,0) | `body`, code, `kbd`, admin, banner, gate |
| Text levels | one text colour | prose secondary `#c3c2b7`; headings, `strong`, `th` and `dt` primary `#fff` | `--text`, `--text-strong` + `base.css` | `.markdown-body`, gate, banner, modal |
| Headings | 600 | 600, `letter-spacing: -0.01em` on h1/h2, `text-wrap: balance`; paragraphs and items `text-wrap: pretty` | look rules | `.markdown-body h1–h6`, `p`, `li` |
| Radii | card 14, blocks 10, gate 12, pills 20 | 8 for panels and blocks, 6 for controls (unchanged), 999 for pills; inline code and `kbd` 4, `mark` 2, images 6 | `--radius-*` + look rules on `:not(pre) > code`, `kbd`, `mark`, `img` | card, code, mermaid, details, gate, overlay, modal, chips |
| Links in prose | blue, underline on hover | blue, **always underlined**: 1px at 80% of the link colour (at least 3:1 on card and page), offset 3px; hover → `--link-hover` with a 2px accent underline | look rule on `.markdown-body a:not([aria-hidden='true'])` | `.markdown-body a` (heading anchors excluded) |
| Code | soft block, header strip | `--plane` well inside the card, hairline, 8px radius, `#171717` header strip, analytics-family syntax colours | tokens + `hljs.css` | `.code-block`, `pre`, `code` |
| Tables | full grid, zebra, soft header | analytics `.setup-table`: horizontal hairlines only, no zebra, raised header with primary 600 text, `6px 12px` cells, `tabular-nums`, row hover tint | tokens + look rules (`border-left/right: 0`, padding, `tbody tr:hover`) | `.markdown-body table` |
| Rules | `hr` 0.25em bar; quote bar 0.25em in `--border` | `hr` 1px hairline (docs-block idiom); quote bar 3px in `#383835` with secondary text | look rules + `--blockquote-*` | `hr`, `blockquote` |
| Focus | browser default, a few custom rings | 2px `--accent` ring at offset 2 everywhere, inset by 1px on fields (analytics `.field`); visible on the cookie toggle | `base.css` | links, buttons, fields, toggle |
| Selection, scrollbars, native controls | browser default, light scrollbars in dark | opaque accent-tinted selection with strong text; thin `#7a7872` / `#86857e` thumbs (3:1); `color-scheme` per mode, so native controls and scrollbars follow the mode | `base.css` + `color-scheme` | page, sidebar, code, tables |
| Password gate | 12px card, blue button with white text | 8px panel, `--field-*` input with a 3:1 border, primary button (dark text on accent), danger text `#ef8a8a` (the message is worded, never colour only) | tokens | `.security-gate*` (also `AssetGate.js`) |
| Admin | underline tabs, solid-red danger hover | pill tabs (analytics `.tab`): look rules make `.admin-tab` radius 999 with padding `6px 14px`, and the active tab raised with a `--border-strong` outline (3.32, the 3:1 state cue) and white text; table headers 11px uppercase muted with `.05em` letter-spacing (`.setup-table th`); danger hover becomes a tint | tokens + look rules | `.admin-tab*`, `.admin-table th`, buttons, bars, modal |
| Cookie banner | coral Accept and Reject | Accept = primary, Reject = tool button, Cookie settings = pill; geometry unchanged | `--consent-*`, `--toggle-*` | `.sgw-*` (classes, opacity and display untouched) |

**Not carried over:**

- The start page's amber "lamp" palette.
- Analytics' 14px base size. The viewer keeps 16px/1.65 for long-form reading (§6).
- The two-tone wordmark. The header title is a single configurable site name.
- Hover lift and motion. The viewer's few 0.15s transitions stay as they are.
- Analytics' failing values: muted `#898781` on raised (4.38), accent as text on raised (4.32), white on accent
  (3.64), `.28` field borders, and dimming by opacity. Each is replaced by the corrected value in §2.

---

## 4. Adding a theme (the sgwireless recipe)

### 4.1 Recipe

1. **Copy** the skeleton `app/themes/sgwireless.css`, or `valley.css` for a worked example, to
   `app/themes/<name>.css`. Replace the name in every selector. Use lowercase, `[a-z0-9-]`.
2. **Fill the seeds** in the light block and the dark block: the 17 existing tokens (§2.1), the 8 new seeds (§2.2)
   and the 15 `--hl-*` (§2.5). Then copy the dark block's declarations into the second dark block unchanged. Keep
   the selectors and `@media screen` wrappers of §1.4 exactly (print depends on them; the lint checks them).
   Optionally add Mermaid's eight categorical colours and their ink (§2.6). Brand colours usually land in `--accent`, `--accent-hover`, `--on-accent`, `--link`, `--link-hover` and the
   surfaces.
3. **Override roles** (§2.4, §2.6) only where the derived value is wrong. Common cases: header or nav treatment, a
   brand-coloured Accept button (`--consent-*`), a field fill, and Mermaid values when a seed is not a plain hex.
4. **Shape** (optional, §2.3): fonts (self-hosted only, because of the CSP) and radii.
5. **Look rules** (optional): only for selectors without a default `html[data-theme=…]` variant (§1.4). Keep the
   prose-link underline unless the link colour reaches 3:1 against the body text in **both** modes.
6. **Register:** add `'<name>'` to `THEMES` in `lib/themes.mjs`, and add `import './themes/<name>.css'` in
   `app/layout.js`.
7. **Check:**
   - `node scripts/check-themes.mjs` (static lint);
   - `node scripts/check-themes.mjs --contrast http://localhost:<port>/` with the theme selected (every pair in §2.7,
     in both modes);
   - `node scripts/check-consent.mjs http://localhost:<port>/`;
   - the screenshot set in §5.3.
8. **Deploy:** a theme is code. Commit it and push `main`; that deploys it to every Amplify app built from the
   repository, where it stays inert unless selected.
9. **Select:** set `"theme": "<name>"` in the site's `content-security.json`. Use the root file locally and the bucket
   copy on S3 sites. It applies within 60 seconds per instance; the 404 page changes at the next build. Selecting it
   before the deploy is harmless: the site keeps the default look and logs the unknown-theme line.

### 4.2 Skeleton: `app/themes/sgwireless.css`

Placeholder values are today's default (GitHub-like) palette, adjusted where the default fails AA, so the skeleton
passes the lint as it stands. **None of them is SG Wireless branding.** Marketing supplies the real values.

```css
/*
 * SG Wireless: SKELETON, not active.
 * Placeholders are the default palette, adjusted to pass WCAG AA; marketing supplies the real values.
 * To activate: replace every TODO, add 'sgwireless' to THEMES in lib/themes.mjs, and import this file in
 * app/layout.js. See THEMES.md §4.
 */

/* 1. Mode-independent */
html[data-palette='sgwireless'] {
  /* --font-sans: …;  TODO brand font: self-host under public/ (CSP font-src 'self'), check the licence */
  /* --font-mono: …; */
  /* --radius-card: 14px;  --radius-card-compact: 10px;  --radius-block: 10px;  --radius-panel: 12px;  --radius-pill: 999px; */
}

/* 2. Light (also the pre-hydration base when the OS is light, and print) */
html[data-palette='sgwireless'][data-palette],
html[data-palette='sgwireless'][data-theme='light'] {
  color-scheme: light;
  --page-bg: #ffffff;              /* TODO */
  --surface: #ffffff;              /* TODO */
  --surface-soft: #f6f8fa;         /* TODO */
  --surface-hover: #eaeef2;        /* TODO */
  --text-strong: #1f2328;          /* TODO */
  --text: #1f2328;                 /* TODO */
  --muted: #57606a;                /* TODO ≥4.5:1 on surface-soft */
  --border: #d0d7de;               /* TODO */
  --border-strong: #818b98;        /* TODO ≥3:1 on surface (field and checkbox borders) */
  --link: #0969da;                 /* TODO brand */
  --link-hover: #0550ae;           /* TODO */
  --accent: #0969da;               /* TODO brand: focus ring, checkbox, primary button */
  --accent-hover: #0550ae;         /* TODO */
  --on-accent: #ffffff;            /* TODO ≥4.5:1 on accent and accent-hover */
  --accent-soft: #eef6ff;          /* TODO */
  --success: #1a7f37;              /* TODO */
  --danger: #cf222e;               /* TODO */
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 8px 24px rgba(16, 24, 40, 0.06);
  --mark-bg: #fff0b2;
  --mark-text: #3f2d00;
  --code-inline-bg: #eff2f6;
  --code-inline-border: #e3e8ee;
  --code-bg: #fafafa;
  --code-border: #d0d7de;
  --code-header-bg: #f0f2f4;
  --hl-fg: #24292e;  --hl-keyword: #cf222e;  --hl-title: #8250df;  --hl-type: #953800;  --hl-attr: #0550ae;
  --hl-string: #0a3069;  --hl-constant: #0550ae;  --hl-comment: #57606a;  --hl-meta: #0550ae;  --hl-tag: #116329;
  --hl-section: #0550ae;  --hl-add-fg: #116329;  --hl-add-bg: #dafbe1;  --hl-del-fg: #82071e;  --hl-del-bg: #ffebe9;
  /* Role overrides (THEMES.md §2.4), only where the derived value is wrong, e.g.:
     --nav-card-bg: …;  --consent-accent: …;  --field-bg: #ffffff; */
}

/* 3. Dark, on screen only. Keep both blocks identical. */
@media screen and (prefers-color-scheme: dark) {
  html[data-palette='sgwireless']:not([data-theme='light']) {
    color-scheme: dark;
    --page-bg: #0d1117;            /* TODO */
    --surface: #0f1722;            /* TODO */
    --surface-soft: #111b29;       /* TODO */
    --surface-hover: #1b2737;      /* TODO */
    --text-strong: #ffffff;        /* TODO */
    --text: #e6edf3;               /* TODO */
    --muted: #9ba7b4;              /* TODO */
    --border: #2f3e52;             /* TODO */
    --border-strong: #6e7681;      /* TODO ≥3:1 on surface */
    --link: #78b7ff;               /* TODO brand */
    --link-hover: #a5d0ff;         /* TODO */
    --accent: #78b7ff;             /* TODO brand */
    --accent-hover: #a5d0ff;       /* TODO */
    --on-accent: #0d1117;          /* TODO (white on #78b7ff is 2.0:1 and fails) */
    --accent-soft: #152436;        /* TODO */
    --success: #3fb950;            /* TODO */
    --danger: #ff7b72;             /* TODO */
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 12px 26px rgba(0, 0, 0, 0.28);
    --mark-bg: #614700;
    --mark-text: #fff4cc;
    --code-inline-bg: #161b22;
    --code-inline-border: #30363d;
    --code-bg: #0d1117;
    --code-border: #30363d;
    --code-header-bg: #161b22;
    --hl-fg: #c9d1d9;  --hl-keyword: #ff7b72;  --hl-title: #d2a8ff;  --hl-type: #ffa657;  --hl-attr: #79c0ff;
    --hl-string: #a5d6ff;  --hl-constant: #79c0ff;  --hl-comment: #8b949e;  --hl-meta: #79c0ff;  --hl-tag: #7ee787;
    --hl-section: #79c0ff;  --hl-add-fg: #aff5b4;  --hl-add-bg: #033a16;  --hl-del-fg: #ffdcd7;  --hl-del-bg: #67060c;
  }
}
@media screen {
  html[data-palette='sgwireless'][data-theme='dark'] {
    /* exactly the declarations of the block above (the lint compares them) */
  }
}

/* 4. Look rules (optional). Only selectors without a default html[data-theme=…] variant. */
html[data-palette='sgwireless'] .markdown-body a:not([aria-hidden='true']) {
  text-decoration: underline;          /* keep unless --link reaches 3:1 against --text in both modes */
  text-underline-offset: 3px;
}
```

When the file is created, the second dark block is written out in full, not left as a comment. It is abbreviated
here only to keep the note readable.

### 4.3 Documentation changes

- **README:** add a **Themes** section after *Google Analytics*, modelled on it. It covers the key, a table
  (`theme`, string, default `"default"`, known values, what happens with an unknown value), the S3 and 60-second note,
  and a pointer to THEMES.md for writing a theme.
- **README troubleshooting:** "Theme toggle changes but Mermaid…" becomes "Light/dark toggle changes but
  Mermaid…". The `comment_banner_themes` wording in the example also uses "theme" to mean the mode and becomes
  "mode".
- **`content-security.json.example`:** add
  `"comment_theme": "Optional site theme: 'default' (or omit) or 'valley'. An unknown name falls back to the default and logs a warning.", "theme": "default"`.

---

## 5. Verification plan

All review artefacts go in `.theme-review/`, which is excluded from git. Every run uses a local root
`content-security.json`, also git-excluded: `content.default`'s config plus `"ga_measurement_id": "G-TEST1234"`, so
the banner shows without real hits. The `theme` key is set per run. The servers are clean `npm run build` +
`npx next start -p <port>` instances:

| Port | Build | Theme |
|---|---|---|
| 3201 | `main` at 25665c6, built in a temporary detached worktree (the main checkout is never touched) | none |
| 3202 | `theme-valley` | none |
| 3203 | `theme-valley` | `"valley"` |
| 3204 | `theme-valley` | `"nope"` |

### 5.1 Matrix

**Pages:**

| Id | Page |
|---|---|
| P1 | `/` (home, site map) |
| P2 | `/test/`: headings, nested blockquote with `strong`, lists, task list, tables, six code languages, KaTeX, three Mermaid diagrams, images, `kbd`, `mark`, `hr`, footnotes |
| P3 | `/examples.md`: long page with TOC, links in headings, JSON code |
| P4 | `/secret/`: password gate, empty and after a wrong password (error) |
| P5 | `/gate/secret/password.zip`: asset gate |
| P6 | `/admin`: login |
| P7 | admin signed in (`DemoAdmin2026#`): Files, Settings, Security with a rule expanded; error and status bars injected into the DOM if read-only mode cannot trigger them |
| P8 | cookie banner, first visit |
| P9 | preferences modal |
| P10 | Cookie settings pill after a choice |
| P11 | Mermaid full-screen overlay |
| P12 | 390×844 viewport: P2 with the TOC drawer open |
| P13 | 404 (`/does-not-exist.md`) |

**Modes:**

| Id | OS | Stored mode | Notes |
|---|---|---|---|
| M0 | light, then dark | — | Pre-hydration frame: CDP `Emulation.setScriptExecutionDisabled`, so only the SSR HTML and CSS paint |
| M1 | light | none | |
| M2 | dark | none | |
| M3 | dark | `light` | Exercises E1 |
| M4 | light | `dark` | |

The OS mode comes from `Emulation.setEmulatedMedia` (`prefers-color-scheme`). The stored mode comes from
`localStorage.theme` set before load. Desktop runs use 1440×900. The 390×844 viewport is used for P2, P8 and P12.

**States** captured on P1, P2 and P8–P10: hover on a header button, a TOC link, a site-map link, a table row, the
copy button, a Mermaid tool button, Accept, Reject and an admin button. Keyboard focus (Tab) on a prose link, a
header button, the copy button, the task checkbox, the gate input and button, Accept and the toggle.

### 5.2 The default is pixel-identical (requirement 1)

1. **Source identity.** A script unwraps every `var(--<new token>, X)` to `X` (balanced parentheses, new-token list
   from §2) on both sides, the branch's and `main`'s `globals.css` and `AdminSettings.js`. Both sides are unwrapped
   because `AdminSecurity.js:406` already has `var(--danger, …)`. The two outputs must be equal byte for byte. A second check confirms that `globals.css` defines none of the new tokens.
2. **HTML identity.** Fetch every page from 3201 and 3202, mask the hashed `/_next/static/…` URLs, and require
   identical markup. In particular, `<html lang="en">` must carry no `data-palette`.
3. **Screenshot identity.** Capture every page × M0–M4 × states × viewport on 3201 and 3202. Compare the PNGs byte for
   byte. If any pair differs, decode it with `zlib` (no dependencies) and count differing pixels; the target is
   **0**. Write a red diff mask to `.theme-review/diff/`. Mermaid output is waited for (`svg` present) and the
   site-map loading dots are waited out before capture.
4. **Computed-style identity.** On both servers, dump `getComputedStyle` (all colours, backgrounds, borders, outline,
   shadows, `font-family`, `border-radius`, `opacity`) for every element on P1–P10 in M1–M4, and diff the dumps. This
   catches states a screenshot does not show.
5. **Unknown theme.** 3204's HTML equals 3202's. The server log has exactly one
   `[theme] unknown theme "nope"` line per config load. Also check `""`, `"default"`, `" Valley "` (normalised to
   `valley`), `42` (warns "must be a string") and an absent key.

### 5.3 Valley review screenshots

Capture the same matrix on 3203 and save it as `.theme-review/valley-<page>-<mode>[-<state>].png`. Then:

- Make a side-by-side sheet: P3 in M2 next to `ref-dashboard-docs.png`, and P2 next to `ref-dashboard-live.png`.
- Check that Mermaid uses the palette: read `fill` and `stroke` of `.node rect` in M2 and M1 and compare them with
  `--mermaid-node-bg` and `--mermaid-node-border`. Toggling the mode re-renders the chart.
- Check that M0 dark already paints valley dark (no flash of the palette) and that M3 shows **no** dark leak: gate
  error `#b42d2d`, hljs light colours, light admin bars.
- Emulate `forced-colors: active` and `prefers-reduced-motion: reduce` in M2: borders, focus rings and the current
  nav item must stay visible.
- Christian reviews the sheet before the look rules are final.

### 5.4 Contrast

1. **Static:** `node .theme-review/contrast.mjs --combined` gives the numbers in §2.7, with 0 failures.
2. **In the browser:** `scripts/check-themes.mjs --contrast <url>` runs on 3203 in M1 and M4. It resolves every
   token through probe elements (`el.style.color = 'var(--x)'`, then reads the computed `rgb()`), composites alpha
   and checks the §2.7 pairs against 4.5:1 or 3:1. It also measures real elements: body text, muted text, a link, a
   `th`, inline code, a code token per role, the gate button, Accept and the toggle. It exits non-zero on any failure.
3. **Static lint:** `scripts/check-themes.mjs` (no URL) checks:
   - selectors are scoped;
   - both mode blocks define the required seeds and `color-scheme`;
   - the two dark blocks are identical;
   - no `:root`, `@layer` or `!important`;
   - every hljs selector in `globals.css` is mirrored in `hljs.css`;
   - `THEMES` matches the imported files.

### 5.5 Consent (requirement 5)

`node scripts/check-consent.mjs http://ma.ehlers.localhost:3202/` and `…:3203/` must both pass all five checks. The
`sgw-*` class names, the banner's `opacity`/`pointer-events` and the modal's `display` must be unchanged (verified by
the identity checks in §5.2).

### 5.6 Config path

- **Root file:** used on 3203.
- **Content provider:** with no root file, put `"theme": "valley"` into a temporary copy of `content.default`'s
  config and confirm the attribute appears. S3 reads through the same `provider.readFile` call, so this covers
  S3-backed sites. Optionally confirm against the real bucket with read-only credentials.
- **Admin save:** saving Settings keeps the `theme` key (unit-level check of `formToConfig`, because the demo admin
  is read-only).
- **Build:** `npm run build` is clean. Report the size of the CSS delta.

### 5.7 Implementation order (one commit each)

1. Registry, loader and attribute.
2. `globals.css`/JSX substitutions, then run §5.2.
3. `base.css`, `hljs.css` and valley's tokens.
4. Mermaid hook.
5. Valley look rules.
6. Skeleton, README, example and `check-themes.mjs`.
7. Full verification and review screenshots.

Re-run §5.2 after steps 2, 3 and 5.

---

## 6. Open questions for Christian

1. **Body text in valley dark:** `#c3c2b7` prose with white headings (the Docs-tab idiom, chosen here), or white
   prose like the denser dashboard panels?
2. **Body size:** keep the viewer's 16px/1.65 (chosen), or use analytics' docs 14.5px/1.65?
3. **Light mode:** analytics has none. The warm-neutral light palette in §2 (`#f3f2ee` page, `#fcfcfa` card,
   `#43423d` text) is new and needs your eye.
4. **Default fixes, each a separate commit if wanted:**
   - (a) the OS-dark leak into the light toggle (E1);
   - (b) the saved-mode flash before hydration (an inline head script);
   - (c) default AA failures found while measuring. Default dark links (`#78b7ff`) differ from body text by only
     1.77:1, and they are not underlined. The default dark gate and admin primary buttons put white on `#78b7ff`
     (2.0:1). The light syntax colours `#22863a` (4.43) and `#e36209` (3.34) are below 4.5:1 on the code well.
     Default Accept on hover turns transparent with black text, which is unreadable in dark mode.

   All of these change the default, so none is in this branch.
5. **404 page:** it bakes the build-time theme and GA ID. Should it become dynamic, so both follow S3 edits without
   a rebuild? Its first HTML is also Next's error shell with no stylesheet, so with scripts off (or until they run)
   it is an unstyled white page in every theme, the default included.
   Two more default-wide accessibility gaps came out of the review: focus can leave the open cookie banner and
   preferences modal for page controls under the backdrop (a focus trap, or `inert` on the page, in
   `CookieBanner.js`), and a copy button reached with Shift+Tab can sit fully under the sticky header
   (`scroll-padding-top` on `html`, with the headings' `scroll-margin-top` reduced to match).
6. **Admin dropdown:** should Settings get a theme selector, or is the config file enough?
7. **SG Wireless inputs needed from marketing:**
   - brand colours for light and dark, or confirmation that the site is light-only;
   - a font, which must be self-hosted;
   - whether Accept should be brand-coloured;
   - logo files, which use the existing `banner`/`bannerLight`/`bannerDark` keys.

---

## 7. Implementation notes

What the branch does differently from the note above, and why.

1. **`--chip-hover-border` (new role token).** The note gave the TOC section pill (345) and the site-root chip (602)
   `--nav-hover-border`. Valley sets that to `transparent` for the rail idiom, which would have made both pills lose
   their outline on hover. They now read `--chip-hover-border` (base: `--border-strong`); the TOC and site-map links
   keep `--nav-hover-border`.
2. **Light ⊆ dark.** The note let a theme override a role in the light block only (valley's `--field-bg: #ffffff`,
   `--backdrop`, `--overlay-shadow`, the light Mermaid values). Because the light block's first selector always
   matches, those values would have applied in dark too. Valley restates them in both dark blocks with the dark
   value, and `check-themes.mjs` enforces the rule (§1.4).
3. **Three extra rules in `base.css`.** A checked task checkbox keeps its fill and tick (the default's OS-dark hover
   rule, and the theme hover rule, use the `background` shorthand, which wipes the tick of a checked box); a code
   block without a language takes `--hl-fg` (it has no `.hljs` class and would otherwise get `--code-inline-fg`,
   white in valley dark); `strong` inside a link keeps the link colour. A `forced-colors` block keeps the current nav
   item and focus rings visible.
4. **Mermaid** leaves out any `--mermaid-*` token that resolves empty instead of passing `undefined`: Mermaid's
   theme copies every key it is given, so an `undefined` would wipe its own default.
5. **`check-themes.mjs --identity [ref]`** is the source-identity check of §5.2 (unwrap `var(--theme-token, X)` to `X`
   in `globals.css`, `AdminSettings.js` and `AdminSecurity.js` on both sides and compare). The theme-token list is
   computed: every custom property defined in `app/themes/*.css` that the ref's `globals.css` does not define.
6. **HTML identity (§5.2.2)** holds for the markup with the inline flight scripts left out (they carry webpack
   module ids, which change whenever any module changes, and stream in a timing-dependent order). The one
   remaining difference is an extra `<link rel="stylesheet">`: the theme CSS is a second chunk, which cannot be
   avoided because CSS cannot be imported conditionally.
7. **Admin table headers** keep the default's weight 600 with the analytics 11px uppercase muted treatment
   (`.setup-table th` uses 400, which is hard to read at 11px on a docs page).
8. **The skeleton** (`app/themes/sgwireless.css`) is written out in full, including the second dark block, and
   passes the lint. It is not imported and not in `THEMES`.
9. **Review round (visual, contrast and code reviews).** Changes after the first implementation:
   - **Placeholders** read `--placeholder` (base: `--muted`, opacity 1). The browser's grey was 3.41:1 on valley's
     dark field, and on the password gate the placeholder is the only visible hint.
   - **Mermaid** maps the Gantt variables and the optional categorical colours (§1.8, §2.6). Group borders, the
     scrollbar thumb and the admin's selected-tab outline reach 3:1; the prose-link underline is 80% of the link
     colour instead of 55%.
   - **Selection** sets the text colour too (`--selection-fg`) on an opaque `--selection-bg`, so muted text, links,
     comments and labels on buttons and diagram fills all become one pair above 4.5:1. (A translucent selection
     with `--text-strong` fell to 3.5:1 over the accent buttons and Mermaid's coloured fills.)
   - **Controls** inherit the page font (`base.css`, at (0,0,0)).
   - **Print** uses the light palette (§1.9): the dark blocks are `screen` only and the light base is (0,2,1).
   - `check-themes.mjs` measures the placeholder (`::placeholder`), the link underline and the selected admin tab
     on the page, and the new token pairs.
   - Left alone, because the default has them too and fixing them changes the default or the consent code: focus
     can leave the cookie banner and modal for controls under the backdrop, a copy button reached with Shift+Tab can
     sit under the sticky header, and the 404 page's first HTML is Next's error shell without stylesheets (white
     until scripts run). See §6.
