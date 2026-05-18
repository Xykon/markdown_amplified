import fs from 'fs'
import path from 'path'
import { collectMarkdownFiles, getActiveContentDir } from '../content-source.mjs'

// Treat the literal string "null" (any casing) as unset.
// Amplify per-branch overrides are always strings, so setting a variable to
// "null" is the only way to revert a branch to filesystem mode.
// Accepts an already-resolved value (not a name) so webpack's static
// process.env.KEY replacement still applies at the call sites.
function env(v) {
  return (!v || /^null$/i.test(v)) ? '' : v
}

// Recursively compute total size and latest mtime for a directory.
function dirStats(dirPath) {
  let size = 0, mtime = null
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      try {
        const full = path.join(dirPath, entry.name)
        const s = fs.statSync(full)
        if (!mtime || s.mtime > mtime) mtime = s.mtime
        if (entry.isFile()) size += s.size
        else if (entry.isDirectory()) {
          const sub = dirStats(full)
          size += sub.size
          if (sub.mtime && (!mtime || sub.mtime > mtime)) mtime = sub.mtime
        }
      } catch { }
    }
  } catch { }
  return { size, mtime }
}

class FilesystemProvider {
  #contentDir

  constructor() {
    this.#contentDir = getActiveContentDir()
  }

  #safePath(relPath) {
    const resolved = path.resolve(this.#contentDir, relPath)
    const root = path.resolve(this.#contentDir)
    return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null
  }

  async readFile(relPath) {
    const filePath = this.#safePath(relPath)
    if (!filePath) return null
    try {
      if (!fs.statSync(filePath).isFile()) return null
    } catch {
      return null
    }
    return fs.readFileSync(filePath)
  }

  async listMarkdownFiles() {
    return collectMarkdownFiles(this.#contentDir)
  }

  async listDirectory(relPrefix) {
    const dirPath = this.#safePath(relPrefix || '.')
    if (!dirPath) return { dirs: [], files: [] }
    let entries
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }) }
    catch { return { dirs: [], files: [] } }
    const dirs = []
    const files = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        const s = dirStats(path.join(dirPath, entry.name))
        dirs.push({ name: entry.name, size: s.size || null, lastModified: s.mtime?.toISOString() ?? null })
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(path.join(dirPath, entry.name))
          files.push({ name: entry.name, size: stat.size, lastModified: stat.mtime.toISOString() })
        } catch {
          files.push({ name: entry.name, size: 0, lastModified: null })
        }
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))
    return { dirs, files }
  }

  async writeFile(relPath, content) {
    const filePath = this.#safePath(relPath)
    if (!filePath) throw new Error('Invalid path')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }

  async deleteFile(relPath) {
    const filePath = this.#safePath(relPath)
    if (!filePath) throw new Error('Invalid path')
    fs.unlinkSync(filePath)
  }

  async createDirectory(relPath) {
    const dirPath = this.#safePath(relPath)
    if (!dirPath) throw new Error('Invalid path')
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

class S3Provider {
  #bucket
  #prefix
  #client = null

  constructor(bucket, prefix) {
    this.#bucket = bucket
    this.#prefix = prefix ? (prefix.endsWith('/') ? prefix : prefix + '/') : ''
  }

  #safe(relPath) {
    const normalized = path.posix.normalize(relPath)
    return !normalized.startsWith('../') && !path.posix.isAbsolute(normalized)
  }

  async #getClient() {
    if (!this.#client) {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const config = {}
      const region = env(process.env.S3_REGION)
      if (region) config.region = region
      const accessKeyId = env(process.env.S3_ACCESS_KEY_ID)
      const secretAccessKey = env(process.env.S3_SECRET_ACCESS_KEY)
      if (accessKeyId && secretAccessKey) {
        config.credentials = { accessKeyId, secretAccessKey }
      }
      this.#client = new S3Client(config)
    }
    return this.#client
  }

  async readFile(relPath) {
    if (!this.#safe(relPath)) return null
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.#getClient()
    try {
      const { Body } = await client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.#prefix + relPath,
      }))
      const bytes = await Body.transformToByteArray()
      return Buffer.from(bytes)
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  async listMarkdownFiles() {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const client = await this.#getClient()
    const files = []
    let continuationToken

    do {
      const { Contents, NextContinuationToken } = await client.send(new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: this.#prefix,
        ContinuationToken: continuationToken,
      }))

      for (const obj of Contents ?? []) {
        const rel = obj.Key.slice(this.#prefix.length)
        if (rel.endsWith('.md') && this.#safe(rel)) {
          files.push(rel)
        }
      }

      continuationToken = NextContinuationToken
    } while (continuationToken)

    return files
  }

  async listDirectory(relPrefix) {
    const prefix = relPrefix ? (relPrefix.endsWith('/') ? relPrefix : relPrefix + '/') : ''
    if (prefix && !this.#safe(prefix)) return { dirs: [], files: [] }
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const client = await this.#getClient()
    // List without Delimiter to get all objects recursively in one pass so we
    // can compute folder size and last-modified by aggregating children.
    const fullPrefix = this.#prefix + prefix
    const dirMap = new Map() // dirName -> { size, _mtime, lastModified }
    const files = []
    let continuationToken

    do {
      const res = await client.send(new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }))

      for (const obj of res.Contents ?? []) {
        const rel = obj.Key.slice(fullPrefix.length)
        if (!rel) continue
        const slash = rel.indexOf('/')
        if (slash === -1) {
          // Direct file in this directory
          if (!rel.startsWith('.'))
            files.push({ name: rel, size: obj.Size ?? 0, lastModified: obj.LastModified?.toISOString() ?? null })
        } else {
          // Object inside a subdirectory — aggregate stats
          const dirName = rel.slice(0, slash)
          if (dirName.startsWith('.')) continue
          const rest = rel.slice(slash + 1)
          if (!rest) continue // skip bare directory-marker objects (trailing slash)
          const objMtime = obj.LastModified ? new Date(obj.LastModified) : null
          const entry = dirMap.get(dirName)
          if (entry) {
            entry.size += obj.Size ?? 0
            if (objMtime && (!entry._mtime || objMtime > entry._mtime)) {
              entry._mtime = objMtime
              entry.lastModified = obj.LastModified?.toISOString() ?? null
            }
          } else {
            dirMap.set(dirName, { size: obj.Size ?? 0, _mtime: objMtime, lastModified: obj.LastModified?.toISOString() ?? null })
          }
        }
      }

      continuationToken = res.NextContinuationToken
    } while (continuationToken)

    const dirs = Array.from(dirMap.entries())
      .map(([name, { size, lastModified }]) => ({ name, size: size || null, lastModified }))
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))
    return { dirs, files }
  }

  async writeFile(relPath, content) {
    if (!this.#safe(relPath)) throw new Error('Invalid path')
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.#getClient()
    await client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: this.#prefix + relPath,
      Body: content,
    }))
  }

  async deleteFile(relPath) {
    if (!this.#safe(relPath)) throw new Error('Invalid path')
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.#getClient()
    await client.send(new DeleteObjectCommand({
      Bucket: this.#bucket,
      Key: this.#prefix + relPath,
    }))
  }

  async createDirectory(relPath) {
    const dirKey = relPath.endsWith('/') ? relPath : relPath + '/'
    if (!this.#safe(dirKey)) throw new Error('Invalid path')
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.#getClient()
    await client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: this.#prefix + dirKey,
      Body: '',
    }))
  }
}

let _provider = null

export function getContentProvider() {
  if (_provider) return _provider
  const bucket = env(process.env.S3_BUCKET)
  _provider = bucket
    ? new S3Provider(bucket, env(process.env.S3_PREFIX))
    : new FilesystemProvider()
  return _provider
}
