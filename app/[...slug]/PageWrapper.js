'use client'

import SecurityGate from '../SecurityGate'

export default function MarkdownPageWrapper({ slug, content, encrypted, validFrom, validUntil, hasDownload, homeUrl, tocOpen, cookieConfig, siteName, siteBanner, siteBannerLight, siteBannerDark, siteButton }) {
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
      siteBanner={siteBanner}
      siteBannerLight={siteBannerLight}
      siteBannerDark={siteBannerDark}
      siteButton={siteButton}
    />
  )
}
