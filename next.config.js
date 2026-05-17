/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bake S3_BUCKET and S3_PREFIX into the Lambda bundle at build time.
  // Amplify WEB_COMPUTE does not reliably forward console env vars to the
  // Next.js SSR Lambda at runtime, so runtime process.env lookups fail.
  // These values are substituted as compile-time constants; change requires
  // a redeploy.
  env: {
    S3_BUCKET: process.env.S3_BUCKET ?? '',
    S3_PREFIX: process.env.S3_PREFIX ?? '',
    S3_REGION: process.env.S3_REGION ?? '',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  experimental: {
    // @vercel/nft (used by Next.js) excludes files named README.md from Lambda
    // traces, treating them as documentation. Force-include them so symlinks in
    // content/ that point to README.md files resolve correctly at runtime.
    outputFileTracingIncludes: {
      '/**': ['./README.md', './content/README.md', './content.default/README.md'],
    },
  },
}

module.exports = nextConfig
