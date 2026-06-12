'use client'

import { useEffect, useState } from 'react'

export default function SiteMap({ resolvedFile, showSiteroot }) {
  const [tree,    setTree]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [sectionOpen,  setSectionOpen]  = useState(true)
  const [treeKey,      setTreeKey]      = useState(0)
  const [nodeDefault,  setNodeDefault]  = useState(false)

  useEffect(() => {
    const param = resolvedFile ? `?file=${encodeURIComponent(resolvedFile)}` : ''
    fetch(`/api/sitemap${param}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setTree(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const expandAll   = () => { setNodeDefault(true);  setTreeKey(k => k + 1) }
  const collapseAll = () => { setNodeDefault(false); setTreeKey(k => k + 1) }

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
        {sectionOpen && !loading && tree?.children?.length > 0 && (
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
        loading ? (
          <div className="sitemap-loading">
            <span className="sitemap-loading-dot" />
            <span className="sitemap-loading-dot" />
            <span className="sitemap-loading-dot" />
            <span>Indexing…</span>
          </div>
        ) : tree ? (
          <div className="sitemap-tree" key={treeKey}>
            <SiteMapNode
              node={tree}
              current={resolvedFile}
              depth={0}
              defaultOpen={nodeDefault}
              showSiteroot={showSiteroot}
            />
          </div>
        ) : (
          <p className="sitemap-empty">No content found.</p>
        )
      )}
    </div>
  )
}

function SiteMapNode({ node, current, depth, defaultOpen, showSiteroot }) {
  const isCurrent  = node.path === current
  const hasChildren = node.children?.length > 0
  const isRoot     = depth === 0
  const [open, setOpen] = useState(defaultOpen ?? false)

  const href = isRoot ? (node.rootHref ?? '/') : `/${node.path}`

  const linkClass = [
    'sitemap-link',
    isCurrent ? 'is-current' : '',
    isRoot    ? 'is-root'    : '',
  ].filter(Boolean).join(' ')

  // Root "Home" — not collapsible, children always visible
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
