'use client'

import { useEffect, useState } from 'react'

// Two usage modes:
//   hidden  — fetch data and report it via onLoad; renders nothing
//   visible — receive pre-fetched tree prop and render it
export default function SiteMap({ resolvedFile, onLoad, tree: externalTree, hidden, showSiteroot }) {
  const [tree, setTree] = useState(externalTree ?? null)
  const [sectionOpen, setSectionOpen] = useState(true)
  const [treeKey, setTreeKey] = useState(0)
  const [nodeDefault, setNodeDefault] = useState(false)

  const expandAll  = () => { setNodeDefault(true);  setTreeKey(k => k + 1) }
  const collapseAll = () => { setNodeDefault(false); setTreeKey(k => k + 1) }

  // Fetch mode: when hidden=true we fetch once and report the data upward.
  // Pass the current file so the API can determine the correct BFS root
  // (e.g. a folder with home:'folder' starts BFS from that folder's index).
  useEffect(() => {
    if (!hidden) return
    const param = resolvedFile ? `?file=${encodeURIComponent(resolvedFile)}` : ''
    fetch(`/api/sitemap${param}`)
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
    <div className="toc-card">
      <div className="toc-section-row">
        <button
          className="toc-section-header"
          onClick={() => setSectionOpen(o => !o)}
          aria-expanded={sectionOpen}
        >
          <span>Site Map</span>
          <span className="toc-section-chevron">{sectionOpen ? '▾' : '▸'}</span>
        </button>
        {sectionOpen && tree.children?.length > 0 && (
          <button
            className="toc-expand-all"
            onClick={nodeDefault ? collapseAll : expandAll}
            title={nodeDefault ? 'Collapse all' : 'Expand all'}
          >
            {nodeDefault ? '▸▸' : '▾▾'}
          </button>
        )}
      </div>
      {sectionOpen && (
        <div className="sitemap-tree" key={treeKey}>
          <SiteMapNode
            node={tree}
            current={resolvedFile}
            depth={0}
            defaultOpen={nodeDefault}
            showSiteroot={showSiteroot}
          />
        </div>
      )}
    </div>
  )
}

function SiteMapNode({ node, current, depth, defaultOpen, showSiteroot }) {
  const isCurrent = node.path === current
  const hasChildren = node.children?.length > 0
  const isRoot = depth === 0
  const [open, setOpen] = useState(defaultOpen ?? false)

  const href = isRoot ? (node.rootHref ?? '/') : `/${node.path}`

  const linkClass = [
    'sitemap-link',
    isCurrent ? 'is-current' : '',
    isRoot ? 'is-root' : '',
  ].filter(Boolean).join(' ')

  // Root node: not collapsible — Home row always shows, children always visible
  if (isRoot) {
    return (
      <div className="sitemap-node">
        <div className="sitemap-row sitemap-depth-0">
          <a href={href} className={linkClass}>Home</a>
          {showSiteroot && node.rootHref && node.rootHref !== '/' && (
            <a href="/" className="sitemap-siteroot-chip">↑ Site Root</a>
          )}
        </div>
        {hasChildren && (
          <div className="sitemap-children">
            {node.children.map(child => (
              <SiteMapNode
                key={child.path}
                node={child}
                current={current}
                depth={depth + 1}
                defaultOpen={defaultOpen}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Non-root nodes: collapsible if they have children
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
        <a href={href} className={linkClass}>{node.title}</a>
      </div>
      {hasChildren && open && (
        <div className="sitemap-children">
          {node.children.map(child => (
            <SiteMapNode
              key={child.path}
              node={child}
              current={current}
              depth={depth + 1}
              defaultOpen={defaultOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
