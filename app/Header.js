'use client'

import { useContext, useEffect, useState } from 'react'
import { ThemeContext } from './ThemeContext'

const SOURCE_REPO_URL = 'https://github.com/Xykon/markdown_amplified'

export default function Header({ slug, hasToc = false, tocOpen = true, onToggleToc }) {
  const theme = useContext(ThemeContext)
  const [backUrl, setBackUrl] = useState(null)

  useEffect(() => {
    try {
      const ref = document.referrer
      if (ref && new URL(ref).origin === window.location.origin) {
        setBackUrl(ref)
      }
    } catch { /* invalid referrer URL — ignore */ }
  }, [])

  const downloadFile = () => {
    if (!slug) return

    const segments = Array.isArray(slug)
      ? slug
      : String(slug)
          .split('/')
          .filter(Boolean)

    if (segments.length === 0) return

    // If the slug points at a directory (no .md on the last segment),
    // resolve it to the directory's index.md, the same way the page
    // route does. Otherwise the download link would point at a folder
    // under /downloads/ instead of an actual markdown file.
    const lastSegment = segments[segments.length - 1]
    const resolvedSegments = lastSegment.toLowerCase().endsWith('.md')
      ? segments
      : [...segments, 'index.md']

    const fileName = resolvedSegments[resolvedSegments.length - 1]
    if (!fileName) return

    // Download from the downloads directory (supports nested paths)
    const encodedPath = resolvedSegments.map((segment) => encodeURIComponent(segment)).join('/')
    const downloadUrl = `/downloads/${encodedPath}`

    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          {backUrl && (
            <a
              className="header-button back-button"
              href={backUrl}
              title="Back"
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span className="back-button-label">Back</span>
            </a>
          )}
          {hasToc && (
            <button
              className={`header-button toc-toggle-button ${tocOpen ? 'is-open' : ''}`}
              onClick={onToggleToc}
              title={tocOpen ? 'Hide table of contents' : 'Show table of contents'}
              aria-label={tocOpen ? 'Hide table of contents' : 'Show table of contents'}
              aria-pressed={tocOpen}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
                <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
                <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
              </svg>
            </button>
          )}
          <h1 className="header-title">Markdown Viewer</h1>
        </div>
        <div className="header-buttons">
          {slug && (
            <button
              className="header-button download-button"
              onClick={downloadFile}
              title="Download markdown file"
              aria-label="Download markdown file"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="sr-only">Download</span>
            </button>
          )}
          <a
            className="header-button github-button"
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Open source repository"
            aria-label="Open source repository"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.46c.52.1.7-.22.7-.5v-1.75c-2.86.62-3.46-1.21-3.46-1.21-.47-1.19-1.14-1.5-1.14-1.5-.93-.64.07-.63.07-.63 1.03.07 1.57 1.04 1.57 1.04.91 1.55 2.4 1.1 2.98.84.09-.66.36-1.1.66-1.35-2.28-.25-4.67-1.12-4.67-5a3.87 3.87 0 0 1 1.03-2.7 3.57 3.57 0 0 1 .1-2.66s.84-.27 2.75 1.03a9.67 9.67 0 0 1 5 0c1.9-1.3 2.75-1.03 2.75-1.03.37.92.4 1.95.1 2.66a3.85 3.85 0 0 1 1.03 2.7c0 3.9-2.4 4.74-4.68 4.98.37.31.7.93.7 1.89v2.8c0 .28.19.61.71.5A10.5 10.5 0 0 0 12 1.5Z" />
            </svg>
          </a>
          <button
            className="header-button theme-button"
            onClick={theme?.toggleTheme}
            title={theme?.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme?.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme?.isDark ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
