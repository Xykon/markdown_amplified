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

// The security headers Amplify adds from `customHttp.yml`, for the container, which has no Amplify
// in front of it. The values must stay the same as that file's: a change to the policy belongs in
// both places. See `customHttp.yml` for why the CSP allows inline scripts and styles.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://stats.g.doubleclick.net",
      "worker-src 'self' blob:",
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

const nextConfig = {
  // No `X-Powered-By: Next.js` on every response: it tells a scanner which framework to try.
  poweredByHeader: false,

  // The security headers above, in the container only. On Amplify `customHttp.yml` already adds
  // them, and sending them from here as well would double every one of them on the hosted sites.
  ...(process.env.DOCKER_BUILD === '1'
    ? { async headers() { return [{ source: '/:path*', headers: securityHeaders }] } }
    : {}),

  // A self-contained server bundle, for the container image only.
  //
  // `standalone` traces what the server actually imports and emits `.next/standalone` with a
  // `server.js` and a pruned `node_modules`, which is the difference between a ~200MB image and a
  // ~1GB one. It is gated on DOCKER_BUILD rather than set outright because Amplify expects the
  // ordinary `.next` layout that `amplify.yml` publishes as its artifact — this repo has to keep
  // building for both for as long as both are serving.
  ...(process.env.DOCKER_BUILD === '1' ? { output: 'standalone' } : {}),

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
