'use client'

import SecurityGate from '../SecurityGate'

export default function MarkdownPageWrapper({ slug, content, encrypted, validFrom, validUntil, hasDownload, homeUrl, tocOpen, cookieConfig, siteName }) {
  return (
    <SecurityGate
      slug={slug}
      content={content}
      encrypted={encrypted}
      validFrom={validFrom}
      validUntil={validUntil}
      hasDownload={hasDownload}
      homeUrl={homeUrl}
      tocOpen={tocOpen}
      cookieConfig={cookieConfig}
      siteName={siteName}
    />
  )
}
