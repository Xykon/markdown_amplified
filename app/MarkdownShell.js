'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Header from './Header'
import TableOfContents from './TableOfContents'
import MarkdownRenderer from './[...slug]/MarkdownRenderer'
import SiteMap from './SiteMap'

export default function MarkdownShell({ slug, resolvedFile, content, hasDownload = true, homeUrl, tocOpen: tocOpenDefault = true, displayConfig, cookieConfig, siteName, siteBanner, siteBannerLight, siteBannerDark, siteButton }) {
  const {
    showToc = true,
    showSitemap = true,
    sitemapOpen: sitemapOpenDefault = false,
    showSitemapSiteroot = false,
  } = displayConfig ?? {}

  const hasTocContent = useMemo(
    () => showToc && /^(#{1,3})\s+.+$/m.test(content),
    [content, showToc]
  )

  const [siteMapTree, setSiteMapTree] = useState(null)
  const canShowSiteMap = showSitemap && siteMapTree !== null

  // openSections: ordered array — earlier = higher in sidebar.
  // Order tracks which section the user opened first.
  const [openSections, setOpenSections] = useState(() => {
    const initial = []
    if (hasTocContent && tocOpenDefault) initial.push('toc')
    // 'sitemap' deferred until tree loads; see useEffect below
    return initial
  })

  const sitemapDefaultApplied = useRef(false)

  // When the site map tree loads, auto-open if configured to do so.
  useEffect(() => {
    if (!siteMapTree || sitemapDefaultApplied.current) return
    sitemapDefaultApplied.current = true
    if (!sitemapOpenDefault) return
    setOpenSections(prev => {
      if (prev.includes('sitemap')) return prev
      // Respect showSitemapFirst: sitemap above toc
      const hasToc = prev.includes('toc')
      if (hasToc) {
        // Insert sitemap before toc in list (visually first = earlier in array)
        // But we don't have showSitemapFirst here without a ref — default: append
        return [...prev, 'sitemap']
      }
      return [...prev, 'sitemap']
    })
  }, [siteMapTree]) // eslint-disable-line react-hooks/exhaustive-deps

  const tocIsOpen    = openSections.includes('toc')
  const siteMapIsOpen = openSections.includes('sitemap')
  const hasSidebar   = (tocIsOpen && hasTocContent) || (siteMapIsOpen && canShowSiteMap)

  const layoutClass = `page-layout ${hasSidebar ? 'with-toc' : 'no-toc'}`

  function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches
  }

  function toggleSection(section) {
    setOpenSections(prev => {
      const isOpen = prev.includes(section)
      if (isMobile()) {
        return isOpen ? [] : [section]  // exclusive on mobile
      }
      if (isOpen) return prev.filter(s => s !== section)
      return [...prev, section]         // newly opened goes to bottom
    })
  }

  function closeSidebarOnMobile() {
    if (isMobile()) setOpenSections([])
  }

  return (
    <>
      <Header
        slug={hasDownload ? slug : null}
        resolvedFile={hasDownload ? resolvedFile : null}
        hasToc={hasTocContent}
        tocOpen={tocIsOpen}
        onToggleToc={() => toggleSection('toc')}
        hasSiteMap={canShowSiteMap}
        siteMapOpen={siteMapIsOpen}
        onToggleSiteMap={() => toggleSection('sitemap')}
        homeUrl={homeUrl}
        siteName={siteName}
        siteBanner={siteBanner}
        siteBannerLight={siteBannerLight}
        siteBannerDark={siteBannerDark}
        siteButton={siteButton}
      />

      {/* Always mount hidden SiteMap so tree fetch happens in background */}
      {showSitemap && (
        <SiteMap resolvedFile={resolvedFile} onLoad={setSiteMapTree} hidden showSiteroot={showSitemapSiteroot} />
      )}

      <div className={layoutClass}>
        {hasSidebar && (
          <>
            <div className="sidebar">
              {openSections.map(section => {
                if (section === 'toc' && hasTocContent) {
                  return (
                    <TableOfContents key="toc" content={content} onNavigate={closeSidebarOnMobile} />
                  )
                }
                if (section === 'sitemap' && siteMapTree) {
                  return (
                    <SiteMap key="sitemap" resolvedFile={resolvedFile} tree={siteMapTree} showSiteroot={showSitemapSiteroot} />
                  )
                }
                return null
              })}
            </div>
            <button
              type="button"
              className="toc-backdrop"
              aria-label="Close sidebar"
              onClick={() => setOpenSections([])}
            />
          </>
        )}

        <article className="markdown-body">
          <MarkdownRenderer content={content} slug={slug} cookieConfig={cookieConfig} />
        </article>
      </div>
    </>
  )
}
