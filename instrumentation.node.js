// instrumentation.js — Next.js server lifecycle hook (runs once at startup).
//
// In development only:
//   1. After the HTTP server is ready, pre-warms all slug routes so Turbopack
//      compiles them up-front instead of on the first real request.
//   2. Watches the content directory (filesystem provider) or polls S3
//      (S3 provider) for changes, and re-warms any route whose source file
//      was added or modified so it is already compiled for the next visitor.
//
// Nothing runs in production — Amplify Lambda is stateless so background
// timers have no effect, and route compilation happens at `next build` time.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV !== 'development') return

  // Fire-and-forget; must not block or throw synchronously.
  run().catch(() => {})
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

async function run() {
  const { getContentProvider } = await import('./lib/content-provider.mjs')
  const provider = getContentProvider()

  const port = process.env.PORT || 3000
  const base = `http://localhost:${port}`

  await waitForServer(base)

  // Initial warm-up
  const files = await provider.listMarkdownFiles()
  if (files.length > 0) {
    console.log(`\n ⚡ [warm-up] Pre-warming ${files.length} route(s)...`)
    const t = Date.now()
    await warmUpBatch(files, base)
    console.log(` ⚡ [warm-up] Done in ${((Date.now() - t) / 1000).toFixed(1)}s\n`)
  }

  // Start change watcher appropriate for the active backend
  if (process.env.S3_BUCKET) {
    watchS3(base).catch(() => {})
  } else {
    watchFilesystem(provider, base).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Server readiness probe
// ---------------------------------------------------------------------------

async function waitForServer(base, maxAttempts = 40, intervalMs = 250) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 1000)
      await fetch(`${base}/favicon.ico`, { signal: ac.signal })
      clearTimeout(timer)
      return
    } catch {
      await sleep(intervalMs)
    }
  }
}

// ---------------------------------------------------------------------------
// Route warm-up helpers
// ---------------------------------------------------------------------------

async function warmUpBatch(files, base, concurrency = 4) {
  for (let i = 0; i < files.length; i += concurrency) {
    await Promise.all(files.slice(i, i + concurrency).map(f => hitRoute(f, base)))
  }
}

async function hitRoute(file, base) {
  // Directory indexes collapse to their parent path; all other files keep
  // their .md extension so the [slug] handler reads the file directly
  // instead of looking for <name>/index.md (which would 404).
  let slug
  if (file === 'index.md') {
    slug = ''
  } else if (file.endsWith('/index.md')) {
    slug = file.slice(0, -'/index.md'.length)
  } else {
    slug = file  // e.g. "README.md" → "/README.md"
  }
  const url = slug ? `${base}/${slug}` : base
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 20_000)
    await fetch(url, { signal: ac.signal })
    clearTimeout(timer)
  } catch {
    // 404, password gate, timeout — all fine; compilation still happened
  }
}

// ---------------------------------------------------------------------------
// S3 change watcher — polls ListObjectsV2 for added / modified .md files
// ---------------------------------------------------------------------------

async function watchS3(base, pollMs = 30_000) {
  console.log(` ⚡ [s3-watch] Polling for S3 changes every ${pollMs / 1000}s`)

  let snapshot = await s3Snapshot()

  const poll = async () => {
    try {
      const next = await s3Snapshot()
      const changed = []

      for (const [path, mtime] of next) {
        if (snapshot.get(path) !== mtime) changed.push(path)
      }

      if (changed.length > 0) {
        console.log(` ⚡ [s3-watch] ${changed.length} file(s) changed — re-warming...`)
        await warmUpBatch(changed, base)
        snapshot = next
      }
    } catch {
      // Ignore transient S3 errors
    }
    setTimeout(poll, pollMs)
  }

  setTimeout(poll, pollMs)
}

// Build a Map<relativePath, lastModifiedISO> for all .md objects in the bucket
async function s3Snapshot() {
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3')

  const bucket = process.env.S3_BUCKET
  const rawPrefix = process.env.S3_PREFIX
  const prefix = rawPrefix && !/^null$/i.test(rawPrefix)
    ? (rawPrefix.endsWith('/') ? rawPrefix : rawPrefix + '/')
    : ''

  const cfg = {}
  const region = process.env.S3_REGION
  if (region && !/^null$/i.test(region)) cfg.region = region
  const keyId = process.env.S3_ACCESS_KEY_ID
  const secret = process.env.S3_SECRET_ACCESS_KEY
  if (keyId && secret && !/^null$/i.test(keyId)) cfg.credentials = { accessKeyId: keyId, secretAccessKey: secret }

  const client = new S3Client(cfg)
  const map = new Map()
  let token

  do {
    const { Contents, NextContinuationToken } = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    )
    for (const obj of Contents ?? []) {
      const rel = obj.Key.slice(prefix.length)
      if (rel.endsWith('.md') && !rel.startsWith('../') && !rel.startsWith('/')) {
        map.set(rel, obj.LastModified?.toISOString() ?? null)
      }
    }
    token = NextContinuationToken
  } while (token)

  return map
}

// ---------------------------------------------------------------------------
// Filesystem change watcher — uses Node.js fs.watch (recursive, inotify-backed
// on Node 20+ Linux).  Falls back gracefully if not supported.
// ---------------------------------------------------------------------------

async function watchFilesystem(provider, base) {
  const fs = await import('fs')
  const { getActiveContentDir } = await import('./content-source.mjs')
  const contentDir = getActiveContentDir()

  let watcher
  try {
    watcher = fs.watch(contentDir, { recursive: true })
  } catch {
    // fs.watch with recursive unsupported on this platform — skip silently
    return
  }

  console.log(` ⚡ [fs-watch] Watching ${contentDir} for changes`)

  const debounce = new Map()

  watcher.on('change', (event, filename) => {
    if (typeof filename !== 'string') return
    const rel = filename.replace(/\\/g, '/')
    if (!rel.endsWith('.md')) return

    clearTimeout(debounce.get(rel))
    debounce.set(rel, setTimeout(async () => {
      debounce.delete(rel)
      console.log(` ⚡ [fs-watch] ${rel} changed — re-warming`)
      await hitRoute(rel, base)
    }, 400))
  })

  watcher.on('error', () => {})
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms))
