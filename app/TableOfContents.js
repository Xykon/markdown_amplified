'use client'

import { useEffect, useRef, useState } from 'react'

export default function TableOfContents({ content, isOpen = true, onNavigate }) {
  const [headings, setHeadings] = useState([])
  const [activeId, setActiveId] = useState(null)
  const linkRefs = useRef(new Map())

  useEffect(() => {
    // Walk the markdown line by line so we can skip fenced code blocks,
    // otherwise comments like `# foo` inside ```python blocks get picked
    // up as fake h1 entries with no matching anchor in the rendered page.
    const matches = []
    const slugCounts = new Map()
    const lines = content.split('\n')
    let fence = null // current fence marker: '```' or '~~~' or null

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '')
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (fenceMatch) {
        const marker = fenceMatch[1][0].repeat(3)
        if (fence === null) {
          fence = marker
        } else if (marker === fence) {
          fence = null
        }
        continue
      }
      if (fence !== null) continue

      const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (!headingMatch) continue

      const level = headingMatch[1].length
      const text = headingMatch[2].trim()

      // Match github-slugger (used by rehype-slug): lowercase, drop chars
      // that are not alphanumeric / whitespace / `-` / `_`, then turn
      // EACH whitespace char into `-` (do not collapse runs, do not trim
      // leading/trailing `-`).
      let base = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s/g, '-')

      // De-duplicate the same way github-slugger does: foo, foo-1, foo-2…
      const seen = slugCounts.get(base) || 0
      const id = seen === 0 ? base : `${base}-${seen}`
      slugCounts.set(base, seen + 1)

      matches.push({ level, text, id })
    }

    setHeadings(matches)
  }, [content])

  useEffect(() => {
    // Track which heading is in view
    const handleScroll = () => {
      if (headings.length === 0) return

      const headingElements = headings
        .map((h) => ({
          ...h,
          element: document.getElementById(h.id),
        }))
        .filter((h) => h.element)

      if (headingElements.length === 0) return

      // Find the heading closest to the top of the viewport
      let closest = headingElements[0]
      const scrollOffset = 100

      for (const h of headingElements) {
        const rect = h.element.getBoundingClientRect()
        if (rect.top <= scrollOffset && rect.top > closest.element.getBoundingClientRect().top) {
          closest = h
        }
      }

      setActiveId(closest.id)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [headings])

  useEffect(() => {
    if (!isOpen || !activeId) return

    const activeLink = linkRefs.current.get(activeId)
    if (!activeLink) return

    activeLink.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, isOpen])

  if (headings.length === 0) {
    return null
  }

  // Filter to show only h2 and h3 for cleaner TOC
  const tocHeadings = headings.filter((h) => h.level <= 3)

  if (tocHeadings.length === 0) {
    return null
  }

  return (
    <nav className={`table-of-contents ${isOpen ? 'is-open' : 'is-closed'}`}>
      <div className="toc-header">Table of Contents</div>
      <ul className="toc-list">
        {tocHeadings.map((heading) => (
          <li key={heading.id} className={`toc-item toc-level-${heading.level}`}>
            <a
              ref={(node) => {
                if (node) {
                  linkRefs.current.set(heading.id, node)
                } else {
                  linkRefs.current.delete(heading.id)
                }
              }}
              href={`#${heading.id}`}
              className={`toc-link ${activeId === heading.id ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                const element = document.getElementById(heading.id)
                if (element) {
                  element.scrollIntoView({ behavior: 'smooth' })
                  onNavigate?.()
                }
              }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
