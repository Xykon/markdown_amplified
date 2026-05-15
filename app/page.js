import fs from 'fs'
import path from 'path'
import { getActiveContentDir } from '../content-source.mjs'
import MarkdownShell from './MarkdownShell'

function getIndexFile() {
  return path.join(getActiveContentDir(), 'index.md')
}

export default function Home() {
  const INDEX_FILE = getIndexFile()

  if (!fs.existsSync(INDEX_FILE)) {
    return null
  }

  const content = fs.readFileSync(INDEX_FILE, 'utf-8')

  return <MarkdownShell slug={['index.md']} content={content} />
}
