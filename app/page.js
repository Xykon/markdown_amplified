import fs from 'fs'
import path from 'path'
import { getActiveContentDir } from '../content-source.mjs'
import { loadSecurityRules, findRule, isWithinDateRange, encryptContent } from '../lib/security.mjs'
import SecurityGate from './SecurityGate'

function getIndexFile() {
  return path.join(getActiveContentDir(), 'index.md')
}

export default async function Home() {
  const INDEX_FILE = getIndexFile()

  if (!fs.existsSync(INDEX_FILE)) {
    return null
  }

  const rules = loadSecurityRules()
  const rule = findRule('index.md', rules)

  if (rule && !isWithinDateRange(rule)) return null

  const rawContent = fs.readFileSync(INDEX_FILE, 'utf-8')

  let content = rawContent
  let encrypted = null

  if (rule?.password) {
    encrypted = await encryptContent(rawContent, rule.password)
    content = null
  }

  return (
    <SecurityGate
      slug={['index.md']}
      content={content}
      encrypted={encrypted ?? undefined}
      validFrom={rule?.validFrom ?? undefined}
      validUntil={rule?.validUntil ?? undefined}
    />
  )
}
