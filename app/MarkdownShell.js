'use client'

import { useMemo, useState } from 'react'
import Header from './Header'
import TableOfContents from './TableOfContents'
import MarkdownRenderer from './[...slug]/MarkdownRenderer'
import SiteMap from './SiteMap'

export default function MarkdownShell({ slug, resolvedFile, content, hasDownload = true, homeUrl, tocOpen: tocOpenDefault = true, displayConfig, cookieConfig, siteName, siteBanner, siteBannerLight, siteBannerDark, githubUrl, siteButton }) {
  const {
    showToc = true,
    showSitemap = true,
    sitemapOpen: sitemapOpenDefault = false,
    showSitemapFirst = false,
    showSitemapSiteroot = false,
    showSiteroot = false,
    sitemapLabels = 'heading',
  } = displayConfig ?? {}

  // Show the site-root button only when enabled AND home isn't already the root
  const hasSiterootButton = showSiteroot && homeUrl !== '/'

  const hasTocContent = useMemo(
    () => showToc && /^(#{1,3})\s+.+$/m.test(content),
    [content, showToc]
  )

  // openSections: ordered array — earlier index = higher in sidebar.
  // Order tracks which section the user opened first.
  const [openSections, setOpenSections] = useState(() => {
    const toc = hasTocContent && tocOpenDefault
    const sm  = sitemapOpenDefault && showSitemap
    const initial = []
    if (showSitemapFirst) {
      if (sm)  initial.push('sitemap')
      if (toc) initial.push('toc')
    } else {
      if (toc) initial.push('toc')
      if (sm)  initial.push('sitemap')
    }
    return initial
  })

  const tocIsOpen     = openSections.includes('toc')
  const siteMapIsOpen = openSections.includes('sitemap')
  const hasSidebar    = (tocIsOpen && hasTocContent) || (siteMapIsOpen && showSitemap)

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
        hasSiteMap={showSitemap}
        siteMapOpen={siteMapIsOpen}
        onToggleSiteMap={() => toggleSection('sitemap')}
        hasSiteRootButton={hasSiterootButton}
        homeUrl={homeUrl}
        siteName={siteName}
        siteBanner={siteBanner}
        siteBannerLight={siteBannerLight}
        siteBannerDark={siteBannerDark}
        githubUrl={githubUrl}
        siteButton={siteButton}
      />

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
                if (section === 'sitemap' && showSitemap) {
                  return (
                    <SiteMap key="sitemap" resolvedFile={resolvedFile} showSiteroot={showSitemapSiteroot} labels={sitemapLabels} />
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
