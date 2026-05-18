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

const nextConfig = {
  // Bake S3 credentials into the Lambda bundle at build time.
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
  },
  // @vercel/nft (used by Next.js) excludes files named README.md from Lambda
  // traces, treating them as documentation. Force-include them so symlinks in
  // content/ that point to README.md files resolve correctly at runtime.
  outputFileTracingIncludes: {
    '/**': ['./README.md', './content/README.md', './content.default/README.md'],
  },
}

module.exports = nextConfig
