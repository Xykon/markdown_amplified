import fs from 'fs'
import os from 'os'
import path from 'path'

const BUNDLED_ROOT = path.resolve(process.cwd())
const IS_LAMBDA_RUNTIME = Boolean(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME)
const RUNTIME_ROOT = IS_LAMBDA_RUNTIME ? path.join(os.tmpdir(), 'markdown-amplified') : BUNDLED_ROOT

export const CONTENT_DIR = path.join(RUNTIME_ROOT, 'content')
export const DEFAULT_CONTENT_DIR = path.join(RUNTIME_ROOT, 'content.default')

const BUNDLED_CONTENT_DIR = path.join(BUNDLED_ROOT, 'content')
const BUNDLED_DEFAULT_CONTENT_DIR = path.join(BUNDLED_ROOT, 'content.default')

const REPO_ROOT = BUNDLED_ROOT
let runtimeContentPrepared = false

function copySeedDirectory(sourceDir, targetDir) {
  if (fs.existsSync(targetDir)) {
    return
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true })

  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
    return
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true })
}

function ensureRuntimeContentTree() {
  if (!IS_LAMBDA_RUNTIME || runtimeContentPrepared) {
    return
  }

  const bundledContentFiles = collectMarkdownFiles(BUNDLED_CONTENT_DIR)
  const contentSeedDir = bundledContentFiles.length > 0
    ? BUNDLED_CONTENT_DIR
    : BUNDLED_DEFAULT_CONTENT_DIR

  copySeedDirectory(contentSeedDir, CONTENT_DIR)
  copySeedDirectory(BUNDLED_DEFAULT_CONTENT_DIR, DEFAULT_CONTENT_DIR)
  runtimeContentPrepared = true
}

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

export function getWritableContentDir() {
  ensureRuntimeContentTree()
  return CONTENT_DIR
}

export function getActiveContentDir() {
  ensureRuntimeContentTree()

  const customContentFiles = collectMarkdownFiles(CONTENT_DIR)
  if (customContentFiles.length > 0) {
    return CONTENT_DIR
  }

  return DEFAULT_CONTENT_DIR
}

export function getActiveMarkdownFiles() {
  return collectMarkdownFiles(getActiveContentDir())
}
