'use client'

import { useEffect, useState } from 'react'

// Two usage modes:
//   hidden  — fetch data and report it via onLoad; renders nothing
//   visible — receive pre-fetched tree prop and render it
export default function SiteMap({ resolvedFile, onLoad, tree: externalTree, hidden }) {
  const [tree, setTree] = useState(externalTree ?? null)
  const [sectionOpen, setSectionOpen] = useState(true)

  // Fetch mode: when hidden=true we fetch once and report the data upward
  useEffect(() => {
    if (!hidden) return
    fetch('/api/sitemap')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setTree(data); onLoad?.(data) } })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep in sync if parent passes a fresh tree prop (shouldn't change, but be safe)
  useEffect(() => {
    if (externalTree) setTree(externalTree)
  }, [externalTree])

  // Hidden mode: no visible output
  if (hidden) return null

  // Visible mode: render tree
  if (!tree) return null

  return (
    <>
      <div className="sitemap-divider" />
      <button
        className="toc-section-header"
        onClick={() => setSectionOpen(o => !o)}
        aria-expanded={sectionOpen}
      >
        <span>Site Map</span>
        <span className="toc-section-chevron">{sectionOpen ? '▾' : '▸'}</span>
      </button>
      {sectionOpen && (
        <div className="sitemap-tree">
          <SiteMapNode node={tree} current={resolvedFile} depth={0} />
        </div>
      )}
    </>
  )
}

function SiteMapNode({ node, current, depth }) {
  const isCurrent = node.path === current
  const hasChildren = node.children?.length > 0
  const isRoot = depth === 0
  const [open, setOpen] = useState(depth < 2)

  // Root index maps to the canonical home URL
  const href = isRoot ? '/' : `/${node.path}`

  const linkClass = [
    'sitemap-link',
    isCurrent ? 'is-current' : '',
    isRoot ? 'is-root' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="sitemap-node">
      <div className={`sitemap-row sitemap-depth-${depth}`}>
        {hasChildren ? (
          <button
            className="sitemap-toggle"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="sitemap-toggle-placeholder" />
        )}
        <a href={href} className={linkClass}>
          {isRoot ? 'Home' : node.title}
        </a>
      </div>
      {hasChildren && open && (
        <div className="sitemap-children">
          {node.children.map(child => (
            <SiteMapNode
              key={child.path}
              node={child}
              current={current}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
