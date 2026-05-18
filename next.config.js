/** @type {import('next').NextConfig} */

// Amplify only supports global env vars; per-branch "overrides" still exist
// as strings. Setting a variable to the literal string "null" (any casing)
// in a per-branch override is the idiomatic way to revert that branch to
// filesystem mode. Treat all null-like strings as empty/unset at build time
// so they are baked into the Lambda bundle as empty strings.
function resolveEnv(name) {
  const v = process.env[name]
  return (!v || /^null$/i.test(v)) ? '' : v
}

// ADMIN_PATH: the URL path at which the admin interface is served.
// Defaults to 'admin' (i.e. /admin). If a custom path is set, Next.js
// rewrites requests for that path to the internal /admin route.
const adminPath = (resolveEnv('ADMIN_PATH') || 'admin').replace(/^\/+|\/+$/g, '')

const nextConfig = {
  // Bake S3 credentials and ADMIN_PATH into the Lambda bundle at build time.
  // Amplify WEB_COMPUTE does not reliably forward console env vars to the
  // Next.js SSR Lambda at runtime, so runtime process.env lookups fail.
  // These values are substituted as compile-time constants; change requires
  // a redeploy.
  env: {
    S3_BUCKET: resolveEnv('S3_BUCKET'),
    S3_PREFIX: resolveEnv('S3_PREFIX'),
    S3_REGION: resolveEnv('S3_REGION'),
    S3_ACCESS_KEY_ID: resolveEnv('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: resolveEnv('S3_SECRET_ACCESS_KEY'),
    ADMIN_PATH: adminPath,
  },
  // If ADMIN_PATH is not 'admin', rewrite /<ADMIN_PATH> to /admin so the
  // admin page is served from the custom URL without exposing /admin.
  async rewrites() {
    if (adminPath === 'admin') return []
    return [{ source: `/${adminPath}`, destination: '/admin' }]
  },
  // @vercel/nft (used by Next.js) excludes files named README.md from Lambda
  // traces, treating them as documentation. Force-include them so symlinks in
  // content/ that point to README.md files resolve correctly at runtime.
  outputFileTracingIncludes: {
    '/**': ['./README.md', './content/README.md', './content.default/README.md'],
  },
}

module.exports = nextConfig
