import fs from 'fs'
import path from 'path'
import { collectMarkdownFiles, getActiveContentDir } from '../content-source.mjs'

// Treat the literal string "null" (any casing) as unset.
// Amplify per-branch overrides are always strings, so setting a variable to
// "null" is the only way to revert a branch to filesystem mode.
function env(name) {
  const v = process.env[name]
  return (!v || /^null$/i.test(v)) ? '' : v
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
      const region = env('S3_REGION')
      if (region) config.region = region
      const accessKeyId = env('S3_ACCESS_KEY_ID')
      const secretAccessKey = env('S3_SECRET_ACCESS_KEY')
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
}

let _provider = null

export function getContentProvider() {
  if (_provider) return _provider
  const bucket = env('S3_BUCKET')
  _provider = bucket
    ? new S3Provider(bucket, env('S3_PREFIX'))
    : new FilesystemProvider()
  return _provider
}
