'use client'

import SecurityGate from '../SecurityGate'

export default function MarkdownPageWrapper({ slug, content, encrypted, validFrom, validUntil }) {
  return (
    <SecurityGate
      slug={slug}
      content={content}
      encrypted={encrypted}
      validFrom={validFrom}
      validUntil={validUntil}
    />
  )
}
