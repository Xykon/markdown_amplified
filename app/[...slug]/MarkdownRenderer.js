'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

const HASH_SCROLL_OFFSET = 76
const HIGHLIGHT_ALIASES = {
  c: ['h'],
  cpp: ['c++', 'cc', 'cxx', 'hpp', 'hxx', 'hh'],
  shell: ['sh', 'zsh', 'bash'],
  plaintext: ['text', 'txt'],
}

// Sanitize schema applied right after rehype-raw, so any raw HTML embedded
// in markdown (potentially attacker-controlled if admins upload content)
// is stripped of scripts, event handlers, javascript: URLs, etc. before
// downstream plugins (rehype-katex, rehype-highlight) inject their own
// trusted markup. We extend the default GitHub-style schema with `id`,
// `className`, and `style` on all elements so existing markdown that uses
// those attributes for layout (e.g. callouts, anchored headings) keeps
// working.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...((defaultSchema.attributes && defaultSchema.attributes['*']) || []), 'className', 'id', 'style'],
    abbr: ['title'],
  },
  // Keep <details>/<summary> (already in defaults) and allow <video>/<audio>
  // tags for documentation. Scripts and iframes remain blocked.
  // <abbr> for tooltips, <mark> for highlighted text.
  tagNames: [...((defaultSchema.tagNames) || []), 'video', 'audio', 'source', 'track', 'abbr', 'mark'],
}

function extractCodeText(node) {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractCodeText).join('')
  if (node.props?.children) return extractCodeText(node.props.children)
  if (node.type && typeof node.type === 'string') return ''
  return ''
}

function normalizeAnchorLabel(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~\[\]()]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getNodeText(node) {
  if (!node) {
    return ''
  }

  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value || ''
  }

  if (!Array.isArray(node.children)) {
    return ''
  }

  return node.children.map(getNodeText).join('')
}

function visitTree(node, fn) {
  if (!node || typeof node !== 'object') {
    return
  }

  fn(node)

  if (!Array.isArray(node.children)) {
    return
  }

  for (const child of node.children) {
    visitTree(child, fn)
  }
}

function remarkLegacyAnchorAliases() {
  return (tree) => {
    const aliasByLabel = new Map()

    visitTree(tree, (node) => {
      if (node.type !== 'link' || typeof node.url !== 'string' || !node.url.startsWith('#')) {
        return
      }

      const linkText = getNodeText(node)
      const normalized = normalizeAnchorLabel(linkText)
      if (!normalized) {
        return
      }

      const anchor = node.url.slice(1)
      if (!anchor || aliasByLabel.has(normalized)) {
        return
      }

      aliasByLabel.set(normalized, anchor)
    })

    const usedAnchors = new Set()

    visitTree(tree, (node) => {
      if (node.type !== 'heading') {
        return
      }

      const headingText = getNodeText(node)
      const normalized = normalizeAnchorLabel(headingText)
      if (!normalized) {
        return
      }

      const alias = aliasByLabel.get(normalized)
      if (!alias || usedAnchors.has(alias)) {
        return
      }

      node.data = node.data || {}
      node.data.hProperties = node.data.hProperties || {}
      node.data.hProperties.id = alias
      usedAnchors.add(alias)
    })
  }
}

function scrollToHashTarget({ smooth = true } = {}) {
  if (typeof window === 'undefined' || !window.location.hash) {
    return
  }

  const hash = window.location.hash.slice(1)
  if (!hash) {
    return
  }

  const targetId = (() => {
    try {
      return decodeURIComponent(hash)
    } catch {
      return hash
    }
  })()

  const target = document.getElementById(targetId)
  if (!target) {
    return
  }

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  const behavior = smooth && !prefersReducedMotion ? 'smooth' : 'auto'
  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - HASH_SCROLL_OFFSET)

  window.scrollTo({ top, behavior })
}

function MermaidBlock({ chart }) {
  const OVERLAY_ZOOM_STEP = 0.25
  const OVERLAY_ZOOM_MIN = 0.75
  const OVERLAY_ZOOM_MAX = 2.5

  const [svg, setSvg] = useState('')
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayZoom, setOverlayZoom] = useState(1)
  const [mermaidThemeKey, setMermaidThemeKey] = useState('light')

  useEffect(() => {
    function resolveTheme() {
      const explicitTheme = document.documentElement.getAttribute('data-theme')
      if (explicitTheme === 'dark' || explicitTheme === 'light') {
        return explicitTheme
      }
      return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
    }

    function updateThemeKey() {
      setMermaidThemeKey(resolveTheme())
    }

    updateThemeKey()

    const observer = new MutationObserver((entries) => {
      for (const entry of entries) {
        if (entry.type === 'attributes' && entry.attributeName === 'data-theme') {
          updateThemeKey()
          break
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onMediaChange = () => updateThemeKey()
    media?.addEventListener?.('change', onMediaChange)
    media?.addListener?.(onMediaChange)

    return () => {
      observer.disconnect()
      media?.removeEventListener?.('change', onMediaChange)
      media?.removeListener?.(onMediaChange)
    }
  }, [])

  // Close overlay on Escape
  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setOverlayOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])
  const chartRef = useRef(null)
  const id = useId().replace(/[:]/g, '_')

  useEffect(() => {
    let cancelled = false

    async function renderMermaid() {
      try {
        const mermaidModule = await import('mermaid')
        const mermaid = mermaidModule.default
        const isDark = mermaidThemeKey === 'dark'

        const darkThemeVariables = {
          darkMode: true,
          background: '#111b29',
          primaryColor: '#1f2937',
          primaryBorderColor: '#8b949e',
          primaryTextColor: '#e6edf3',
          secondaryColor: '#161b22',
          tertiaryColor: '#0d1117',
          lineColor: '#8b949e',
          textColor: '#e6edf3',
          noteBkgColor: '#30363d',
          noteTextColor: '#e6edf3',
          actorBkg: '#1f2937',
          actorBorder: '#8b949e',
          actorTextColor: '#e6edf3',
          actorLineColor: '#8b949e',
          signalColor: '#c9d1d9',
          signalTextColor: '#c9d1d9',
          labelBoxBkgColor: '#30363d',
          labelTextColor: '#c9d1d9',
          labelBoxBorderColor: '#8b949e',
          loopTextColor: '#c9d1d9',
          activationBorderColor: '#8b949e',
          activationBkgColor: '#1f2937',
        }

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: isDark ? 'base' : 'default',
          themeVariables: isDark ? darkThemeVariables : undefined,
        })

        const { svg: outputSvg } = await mermaid.render(`mermaid_${id}`, chart)
        if (!cancelled) {
          setSvg(outputSvg)
          setError(false)
        }
      } catch {
        if (!cancelled) {
          setError(true)
          setSvg('')
        }
      }
    }

    renderMermaid()

    return () => {
      cancelled = true
    }
  }, [chart, id, mermaidThemeKey])

  if (error) {
    return (
      <div className="code-block">
        <pre>
          <code className="language-mermaid">{chart}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return <div className="mermaid-loading">Rendering diagram...</div>
  }

  async function copySvgToClipboard() {
    try {
      if (!navigator?.clipboard) return
      await navigator.clipboard.writeText(svg)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function downloadSvg() {
    const file = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    downloadBlob(file, 'diagram.svg')
  }

  async function downloadPng() {
    try {
      const host = chartRef.current
      const svgEl = host?.querySelector('svg')
      if (!svgEl) return

      const serializer = new XMLSerializer()
      const source = serializer.serializeToString(svgEl)
      const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      const img = new Image()
      img.onload = () => {
        const scale = 2
        const width = Math.ceil((svgEl.viewBox.baseVal?.width || svgEl.getBoundingClientRect().width) * scale)
        const height = Math.ceil((svgEl.viewBox.baseVal?.height || svgEl.getBoundingClientRect().height) * scale)

        const canvas = document.createElement('canvas')
        canvas.width = Math.max(width, 1)
        canvas.height = Math.max(height, 1)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0)
          canvas.toBlob((blob) => {
            if (blob) {
              downloadBlob(blob, 'diagram.png')
            }
          }, 'image/png')
        }
        URL.revokeObjectURL(svgUrl)
      }
      img.src = svgUrl
    } catch {}
  }

  return (
    <div className="mermaid-block">
      <div className="mermaid-toolbar" role="toolbar" aria-label="Mermaid controls">
        <button
          type="button"
          className="mermaid-tool-button"
          aria-label="Open diagram fullscreen"
          title="Zoom"
          onClick={() => {
            setOverlayZoom(1)
            setOverlayOpen(true)
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1.75 6V3.5A1.75 1.75 0 0 1 3.5 1.75H6" />
            <path d="M10 1.75h2.5A1.75 1.75 0 0 1 14.25 3.5V6" />
            <path d="M14.25 10v2.5a1.75 1.75 0 0 1-1.75 1.75H10" />
            <path d="M6 14.25H3.5a1.75 1.75 0 0 1-1.75-1.75V10" />
          </svg>
        </button>
        <button
          type="button"
          className="mermaid-tool-button"
          title={copied ? 'Copied' : 'Copy SVG'}
          aria-label={copied ? 'Copied' : 'Copy SVG'}
          onClick={copySvgToClipboard}
          data-copied={copied ? 'true' : 'false'}
        >
          {copied ? 'Done' : 'Copy'}
        </button>
        <button
          type="button"
          className="mermaid-tool-button"
          title="Download PNG"
          aria-label="Download PNG"
          onClick={downloadPng}
        >
          PNG
        </button>
        <button
          type="button"
          className="mermaid-tool-button"
          title="Download SVG"
          aria-label="Download SVG"
          onClick={downloadSvg}
        >
          SVG
        </button>
      </div>
      <div className="mermaid-chart" aria-label="Mermaid diagram">
        <div
          ref={chartRef}
          className="mermaid-chart-inner"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {overlayOpen && (
        <div
          className="mermaid-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Diagram fullscreen view"
          onClick={(e) => { if (e.target === e.currentTarget) setOverlayOpen(false) }}
        >
          <div className="mermaid-overlay-inner">
            <button
              type="button"
              className="mermaid-overlay-close"
              aria-label="Close"
              onClick={() => setOverlayOpen(false)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
              </svg>
            </button>
            <div className="mermaid-overlay-body">
              <div
                className="mermaid-overlay-svg"
                style={{ '--mermaid-overlay-zoom': overlayZoom }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
            <div className="mermaid-overlay-toolbar" role="toolbar" aria-label="Diagram zoom controls">
              <button
                type="button"
                className="mermaid-tool-button"
                onClick={() => setOverlayZoom((v) => Math.max(OVERLAY_ZOOM_MIN, Number((v - OVERLAY_ZOOM_STEP).toFixed(2))))}
                disabled={overlayZoom <= OVERLAY_ZOOM_MIN}
              >
                Zoom Out
              </button>
              <button
                type="button"
                className="mermaid-tool-button"
                onClick={() => setOverlayZoom(1)}
                disabled={overlayZoom === 1}
              >
                Reset
              </button>
              <button
                type="button"
                className="mermaid-tool-button"
                onClick={() => setOverlayZoom((v) => Math.min(OVERLAY_ZOOM_MAX, Number((v + OVERLAY_ZOOM_STEP).toFixed(2))))}
                disabled={overlayZoom >= OVERLAY_ZOOM_MAX}
              >
                Zoom In
              </button>
              <span className="mermaid-overlay-zoom-label">{Math.round(overlayZoom * 100)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// Collect all cached unlock passwords from sessionStorage + cookies, deduplicated.
function collectUnlockPasswords(cookieConfig) {
  const seen = new Set()
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i)
    if (k?.startsWith('md-unlock:')) {
      const v = sessionStorage.getItem(k)
      if (v) seen.add(v)
    }
  }
  if (cookieConfig) {
    for (const part of document.cookie.split('; ')) {
      const eq = part.indexOf('=')
      if (eq > 0 && part.slice(0, eq).startsWith(`${cookieConfig.prefix}-unlock-`)) {
        const v = decodeURIComponent(part.slice(eq + 1))
        if (v) seen.add(v)
      }
    }
  }
  return Array.from(seen)
}

// Try every cached unlock password against the download API for an asset.
// Returns true and triggers a blob download if one succeeds; false otherwise.
async function tryProtectedDownload(assetHref, cookieConfig) {
  const relPath = assetHref.replace(/^\/asset\//, '')
  const encodedPath = relPath.split('/').map(encodeURIComponent).join('/')
  const filename = relPath.split('/').pop() || 'download'

  for (const password of collectUnlockPasswords(cookieConfig)) {
    try {
      const res = await fetch(`/api/asset-download/${encodedPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) continue
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch { /* wrong password or network error — try next */ }
  }
  return false
}

export default function MarkdownRenderer({ content, slug, cookieConfig }) {
  const processedContent = useMemo(() => content, [content])

  // Compute the directory portion of the current page's slug so relative
  // image URLs can be rewritten to /asset/<dir>/<src> and served by the
  // asset route handler. Absolute and root-relative URLs are left unchanged.
  const assetBase = useMemo(() => {
    if (!slug || slug.length === 0) return ''
    const parts = [...slug]
    if (parts[parts.length - 1].endsWith('.md')) parts.pop()
    return parts.join('/')
  }, [slug])

  useEffect(() => {
    const initial = window.requestAnimationFrame(() => {
      scrollToHashTarget({ smooth: false })
    })

    const onHashChange = () => scrollToHashTarget({ smooth: true })
    window.addEventListener('hashchange', onHashChange)

    return () => {
      window.cancelAnimationFrame(initial)
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [processedContent])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkLegacyAnchorAliases]}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, SANITIZE_SCHEMA],
        rehypeSlug,
        [rehypeAutolinkHeadings, { behavior: 'append', content: { type: 'text', value: '#' } }],
        rehypeKatex,
        [rehypeHighlight, { aliases: HIGHLIGHT_ALIASES }],
      ]}
      components={{
        pre({ children }) {
          const codeElement = Array.isArray(children) ? children[0] : children
          const rawClassName = codeElement?.props?.className
          const className = Array.isArray(rawClassName) ? rawClassName.join(' ') : rawClassName || ''
          const renderedCode = codeElement?.props?.children ?? ''
          const codeText = extractCodeText(renderedCode).replace(/\n$/, '')
          const langMatch = className.match(/language-([^\s]+)/)
          const lang = langMatch?.[1]?.toLowerCase() ?? null

          if (lang === 'mermaid') {
            return <MermaidBlock chart={codeText} />
          }

          return (
            <div className="code-block">
              <div className="code-block-header">
                {lang && <span className="code-lang">{lang}</span>}
                <button
                  type="button"
                  className="copy-button"
                  aria-label="Copy code"
                  onClick={async (event) => {
                    try {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        await navigator.clipboard.writeText(codeText)
                        const btn = event.currentTarget
                        btn.dataset.copied = 'true'
                        setTimeout(() => {
                          btn.dataset.copied = 'false'
                        }, 1400)
                      }
                    } catch {}
                  }}
                >
                  <span className="copy-button-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="6" y="2.5" width="7.5" height="9.5" rx="1.5" />
                      <path d="M4 4.5H3.5A1.5 1.5 0 0 0 2 6v7.5A1.5 1.5 0 0 0 3.5 15H11A1.5 1.5 0 0 0 12.5 13.5V13" />
                    </svg>
                  </span>
                  <span className="copy-button-check" aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3 8.2 6.2 11.2 13 4.8" />
                    </svg>
                  </span>
                  <span className="sr-only">Copy</span>
                </button>
              </div>
              <pre>
                <code className={className}>{renderedCode}</code>
              </pre>
            </div>
          )
        },
        code({ className, children, ...props }) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },
        a({ href, children, ...props }) {
          let resolved = href
          if (href && !/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(href)) {
            const base = assetBase ? `${assetBase}/` : ''
            resolved = href.endsWith('.md')
              ? `/${base}${href}`
              : `/asset/${base}${href}`
          }
          const isExternal = (() => {
            if (!/^https?:\/\//i.test(resolved)) return false
            try { return new URL(resolved).origin !== window.location.origin } catch { return true }
          })()

          const isAsset = typeof resolved === 'string' && resolved.startsWith('/asset/')

          return (
            <a
              href={resolved}
              onClick={isAsset ? (e) => {
                try {
                  // Only intercept if there are cached unlock passwords in this session.
                  // If a password matches, trigger a blob download and stay on the page.
                  // If none match (wrong password or file is unprotected), fall through to
                  // normal navigation — the asset route will serve the file or redirect to /gate/.
                  let hasCached = collectUnlockPasswords(cookieConfig).length > 0
                  if (!hasCached) return
                  e.preventDefault()
                  tryProtectedDownload(resolved, cookieConfig).then((success) => {
                    if (!success) window.location.href = resolved
                  })
                } catch { /* let normal navigation happen */ }
              } : undefined}
              {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              {...props}
            >
              {children}
            </a>
          )
        },
        img({ src, alt, ...props }) {
          const resolved =
            src && !/^(https?:\/\/|\/)/.test(src)
              ? `/asset/${assetBase ? assetBase + '/' : ''}${src}`
              : src
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={resolved} alt={alt ?? ''} {...props} />
        },
      }}
    >
      {processedContent}
    </ReactMarkdown>
  )
}
