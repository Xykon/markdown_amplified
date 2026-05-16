import fs from 'fs'
import path from 'path'

export const CONTENT_DIR = path.join(process.cwd(), 'content')
export const DEFAULT_CONTENT_DIR = path.join(process.cwd(), 'content.default')

const REPO_ROOT = path.resolve(process.cwd())

function toUnixPath(p) {
  return p.split(path.sep).join('/')
}

export function collectMarkdownFiles(dir, baseDir = dir, files = []) {
  if (!fs.existsSync(dir)) {
    return files
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      collectMarkdownFiles(fullPath, baseDir, files)
      continue
    }

    if (entry.isSymbolicLink()) {
      try {
        const resolved = fs.realpathSync(fullPath)
        const withinRepo = resolved === REPO_ROOT || resolved.startsWith(REPO_ROOT + path.sep)
        if (withinRepo && fs.statSync(resolved).isDirectory()) {
          collectMarkdownFiles(fullPath, baseDir, files)
          continue
        }
      } catch {
        // Dead symlink or access error — fall through to file check
      }
    }

    if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.md')) {
      files.push(toUnixPath(path.relative(baseDir, fullPath)))
    }
  }

  return files
}

export function getActiveContentDir() {
  const customContentFiles = collectMarkdownFiles(CONTENT_DIR)
  if (customContentFiles.length > 0) {
    return CONTENT_DIR
  }

  return DEFAULT_CONTENT_DIR
}

export function getActiveMarkdownFiles() {
  return collectMarkdownFiles(getActiveContentDir())
}
