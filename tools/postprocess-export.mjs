import fs from 'fs'
import path from 'path'
import { getActiveContentDir } from '../content-source.mjs'

const OUT_DIR = path.join(process.cwd(), 'out')
const DOWNLOADS_DIR = path.join(OUT_DIR, 'downloads')

function walk(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, callback)
      continue
    }

    callback(fullPath)
  }
}

function toUnixPath(p) {
  return p.split(path.sep).join('/')
}

if (!fs.existsSync(OUT_DIR)) {
  console.error(`Export directory not found: ${OUT_DIR}`)
  process.exit(1)
}

const htmlTargets = []
const txtTargets = []

walk(OUT_DIR, (filePath) => {
  const rel = toUnixPath(path.relative(OUT_DIR, filePath))

  if (rel.endsWith('.md.html')) {
    htmlTargets.push(filePath)
  }

  if (rel.endsWith('.md.txt')) {
    txtTargets.push(filePath)
  }
})

for (const htmlFile of htmlTargets) {
  const mdFile = htmlFile.slice(0, -'.html'.length)
  fs.renameSync(htmlFile, mdFile)
}

for (const txtFile of txtTargets) {
  fs.unlinkSync(txtFile)
}

// Copy markdown files to downloads/, and copy non-markdown asset files
// (images, etc.) alongside their pages so relative references resolve.
const CONTENT_DIR = getActiveContentDir()

if (fs.existsSync(CONTENT_DIR)) {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
  }

  let copiedMd = 0
  let copiedAssets = 0
  walk(CONTENT_DIR, (src) => {
    const rel = toUnixPath(path.relative(CONTENT_DIR, src))

    if (rel.endsWith('.md')) {
      const dest = path.join(DOWNLOADS_DIR, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
      copiedMd += 1
      return
    }

    // Copy non-markdown assets to the same relative path under out/
    // so markdown pages can reference them with relative URLs.
    const assetDest = path.join(OUT_DIR, rel)
    fs.mkdirSync(path.dirname(assetDest), { recursive: true })
    fs.copyFileSync(src, assetDest)
    copiedAssets += 1
  })

  console.log(`Copied ${copiedMd} markdown files to downloads directory.`)
  console.log(`Copied ${copiedAssets} asset files to export root.`)
}

console.log(`Post-processed export: renamed ${htmlTargets.length} .md.html files and removed ${txtTargets.length} .md.txt files.`)