'use client'

import { useEffect, useRef, useState } from 'react'

function buildTree(headings) {
  const roots = []
  let lastRoot = null
  for (const h of headings) {
    if (h.level <= 2) {
      const node = { ...h, children: [] }
      roots.push(node)
      lastRoot = node
    } else {
      const node = { ...h, children: [] }
      if (lastRoot) lastRoot.children.push(node)
      else roots.push(node)
    }
  }
  return roots
}

function TocNode({ node, activeId, linkRefs, onNavigate, defaultOpen }) {
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(defaultOpen ?? false)

  return (
    <li className={`toc-item toc-level-${node.level}`}>
      <div className="toc-row">
        {hasChildren ? (
          <button
            className="toc-toggle"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="toc-toggle-placeholder" />
        )}
        <a
          ref={(el) => {
            if (el) linkRefs.current.set(node.id, el)
            else linkRefs.current.delete(node.id)
          }}
          href={`#${node.id}`}
          className={`toc-link ${activeId === node.id ? 'active' : ''}`}
          onClick={(e) => {
            e.preventDefault()
            if (hasChildren) setOpen(true)
            document.getElementById(node.id)?.scrollIntoView({ behavior: 'smooth' })
            onNavigate?.()
          }}
        >
          {node.text}
        </a>
      </div>
      {hasChildren && open && (
        <ul className="toc-list toc-children">
          {node.children.map(child => (
            <TocNode
              key={child.id}
              node={child}
              activeId={activeId}
              linkRefs={linkRefs}
              onNavigate={onNavigate}
              defaultOpen={defaultOpen}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function TableOfContents({ content, onNavigate }) {
  const [headings, setHeadings] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [tocSectionOpen, setTocSectionOpen] = useState(true)
  const [treeKey, setTreeKey] = useState(0)
  const [nodeDefault, setNodeDefault] = useState(false)
  const linkRefs = useRef(new Map())

  useEffect(() => {
    const matches = []
    const slugCounts = new Map()
    const lines = content.split('\n')
    let fence = null

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '')
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (fenceMatch) {
        const marker = fenceMatch[1][0].repeat(3)
        if (fence === null) fence = marker
        else if (marker === fence) fence = null
        continue
      }
      if (fence !== null) continue

      const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (!headingMatch) continue

      const level = headingMatch[1].length
      const text = headingMatch[2].trim()

      let base = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s/g, '-')

      const seen = slugCounts.get(base) || 0
      const id = seen === 0 ? base : `${base}-${seen}`
      slugCounts.set(base, seen + 1)

      matches.push({ level, text, id })
    }

    setHeadings(matches)
  }, [content])

  useEffect(() => {
    const handleScroll = () => {
      if (headings.length === 0) return
      const els = headings
        .map(h => ({ ...h, element: document.getElementById(h.id) }))
        .filter(h => h.element)
      if (els.length === 0) return

      let closest = els[0]
      const scrollOffset = 100
      for (const h of els) {
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
    if (!activeId) return
    linkRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const tocHeadings = headings.filter(h => h.level <= 3)
  const tree = buildTree(tocHeadings)
  const hasCollapsibleNodes = tree.some(n => n.children.length > 0)

  const expandAll  = () => { setNodeDefault(true);  setTreeKey(k => k + 1) }
  const collapseAll = () => { setNodeDefault(false); setTreeKey(k => k + 1) }

  return (
    <nav className="table-of-contents">
      <div className="toc-card">
        <div className="toc-section-row">
          <button
            className="toc-section-header"
            onClick={() => setTocSectionOpen(o => !o)}
            aria-expanded={tocSectionOpen}
          >
            <span>Table of Contents</span>
            <span className="toc-section-chevron">{tocSectionOpen ? '▾' : '▸'}</span>
          </button>
          {tocSectionOpen && hasCollapsibleNodes && (
            <button
              className="toc-expand-all"
              onClick={nodeDefault ? collapseAll : expandAll}
              title={nodeDefault ? 'Collapse all' : 'Expand all'}
            >
              {nodeDefault ? '▸▸' : '▾▾'}
            </button>
          )}
        </div>
        {tocSectionOpen && (
          <ul className="toc-list" key={treeKey}>
            {tree.map(node => (
              <TocNode
                key={node.id}
                node={node}
                activeId={activeId}
                linkRefs={linkRefs}
                onNavigate={onNavigate}
                defaultOpen={nodeDefault}
              />
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}
