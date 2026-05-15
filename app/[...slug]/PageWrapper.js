'use client'

import MarkdownShell from '../MarkdownShell'

export default function MarkdownPageWrapper({ slug, content }) {
  return <MarkdownShell slug={slug} content={content} />
}
