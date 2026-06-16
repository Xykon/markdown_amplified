'use client'

import SecurityGate from '../SecurityGate'

export default function MarkdownPageWrapper({ slug, resolvedFile, content, encrypted, validFrom, validUntil, hasDownload, homeUrl, tocOpen, displayConfig, cookieConfig, siteName, siteBanner, siteBannerLight, siteBannerDark, githubUrl, siteButton }) {
  return (
    <SecurityGate
      slug={slug}
      resolvedFile={resolvedFile}
      content={content}
      encrypted={encrypted}
      validFrom={validFrom}
      validUntil={validUntil}
      hasDownload={hasDownload}
      homeUrl={homeUrl}
      tocOpen={tocOpen}
      displayConfig={displayConfig}
      cookieConfig={cookieConfig}
      siteName={siteName}
      siteBanner={siteBanner}
      siteBannerLight={siteBannerLight}
      siteBannerDark={siteBannerDark}
      githubUrl={githubUrl}
      siteButton={siteButton}
    />
  )
}
