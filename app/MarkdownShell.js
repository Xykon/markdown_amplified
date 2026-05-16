'use client'

import { useEffect, useMemo, useState } from 'react'
import Header from './Header'
import TableOfContents from './TableOfContents'
import MarkdownRenderer from './[...slug]/MarkdownRenderer'

export default function MarkdownShell({ slug, content, hasDownload = true }) {
  const hasToc = useMemo(() => /^(#{1,3})\s+.+$/m.test(content), [content])
  const [tocOpen, setTocOpen] = useState(true)

  const layoutClassName = [
    'page-layout',
    hasToc ? (tocOpen ? 'with-toc' : 'without-toc') : 'no-toc',
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

  const closeTocOnMobile = () => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setTocOpen(false)
    }
  }

  return (
    <>
      <Header
        slug={hasDownload ? slug : null}
        hasToc={hasToc}
        tocOpen={tocOpen}
        onToggleToc={() => setTocOpen((open) => !open)}
      />

      <div className={layoutClassName}>
        {hasToc && (
          <>
            <TableOfContents content={content} isOpen={tocOpen} onNavigate={closeTocOnMobile} />
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
          <MarkdownRenderer content={content} />
        </article>
      </div>
    </>
  )
}
