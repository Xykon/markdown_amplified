/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @vercel/nft (used by Next.js) excludes files named README.md from Lambda
    // traces, treating them as documentation. Force-include them so symlinks in
    // content/ that point to README.md files resolve correctly at runtime.
    outputFileTracingIncludes: {
      '/**': ['./README.md', './content/README.md'],
    },
  },
}

module.exports = nextConfig
