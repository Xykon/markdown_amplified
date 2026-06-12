'use client'

import { useEffect, useMemo, useState } from 'react'
import Header from './Header'
import TableOfContents from './TableOfContents'
import MarkdownRenderer from './[...slug]/MarkdownRenderer'
import SiteMap from './SiteMap'

export default function MarkdownShell({ slug, resolvedFile, content, hasDownload = true, homeUrl, tocOpen: tocOpenDefault = true, displayConfig, cookieConfig, siteName, siteBanner, siteBannerLight, siteBannerDark, siteButton }) {
  const { showToc = true, showSitemap = true, showSitemapFirst = false, showSitemapSiteroot = false } = displayConfig ?? {}

  const hasToc = useMemo(() => showToc && /^(#{1,3})\s+.+$/m.test(content), [content, showToc])
  const [tocOpen, setTocOpen] = useState(tocOpenDefault)
  const [siteMapTree, setSiteMapTree] = useState(null)

  // Show the sidebar when ToC has headings or site map has loaded (respecting feature flags)
  const hasSidebar = hasToc || (showSitemap && siteMapTree !== null)

  const layoutClassName = [
    'page-layout',
    hasSidebar ? (tocOpen ? 'with-toc' : 'without-toc') : 'no-toc',
  ].join(' ')

  useEffect(() => {
    if (!hasToc) {
      setTocOpen(false)
      return
    }

    const isMobile = window.matchMedia('(max-width: 768px)').matches
    if (isMobile) {
      setTocOpen(false)
    }
  }, [hasToc])

  // Auto-open the sidebar when the site map loads on a page with no ToC headings
  useEffect(() => {
    if (!hasToc && siteMapTree) setTocOpen(true)
  }, [siteMapTree, hasToc])

  const closeTocOnMobile = () => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setTocOpen(false)
    }
  }

  return (
    <>
      <Header
        slug={hasDownload ? slug : null}
        resolvedFile={hasDownload ? resolvedFile : null}
        hasToc={hasSidebar}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen((open) => !open)}
        homeUrl={homeUrl}
        siteName={siteName}
        siteBanner={siteBanner}
        siteBannerLight={siteBannerLight}
        siteBannerDark={siteBannerDark}
        siteButton={siteButton}
      />

      {/*
        Hidden SiteMap fetches in the background when the feature is enabled.
        On pages without ToC headings, onLoad fires → siteMapTree is set →
        hasSidebar becomes true → the sidebar renders on the next paint.
      */}
      {showSitemap && (
        <SiteMap resolvedFile={resolvedFile} onLoad={setSiteMapTree} hidden showSiteroot={showSitemapSiteroot} />
      )}

      <div className={layoutClassName}>
        {hasSidebar && (
          <>
            <TableOfContents
              content={hasToc ? content : ''}
              isOpen={tocOpen}
              onNavigate={closeTocOnMobile}
              topContent={showSitemap && siteMapTree && showSitemapFirst
                ? <SiteMap resolvedFile={resolvedFile} tree={siteMapTree} showSiteroot={showSitemapSiteroot} />
                : undefined}
            >
              {showSitemap && siteMapTree && !showSitemapFirst && (
                <SiteMap resolvedFile={resolvedFile} tree={siteMapTree} showSiteroot={showSitemapSiteroot} />
              )}
            </TableOfContents>
            {tocOpen && (
              <button
                type="button"
                className="toc-backdrop"
                aria-label="Close table of contents"
                onClick={() => setTocOpen(false)}
              />
            )}
          </>
        )}

        <article className="markdown-body">
          <MarkdownRenderer content={content} slug={slug} cookieConfig={cookieConfig} />
        </article>
      </div>
    </>
  )
}
