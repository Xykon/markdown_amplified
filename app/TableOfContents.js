'use client'

import { useEffect, useState } from 'react'

export default function TableOfContents({ content, isOpen = true, onNavigate }) {
  const [headings, setHeadings] = useState([])
  const [activeId, setActiveId] = useState(null)

  useEffect(() => {
    // Extract headings from markdown content using regex
    const headingRegex = /^(#{1,6})\s+(.+)$/gm
    const matches = []
    let match

    while ((match = headingRegex.exec(content)) !== null) {
      const level = match[1].length // 1-6
      const text = match[2].trim()

      // Convert heading text to ID (matches what rehypeSlug does)
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')

      matches.push({
        level: parseInt(level),
        text,
        id,
      })
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
