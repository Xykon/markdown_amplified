import { loadGlobalSeo } from '../lib/security.mjs'

// Per request, for the same reason as sitemap.js: its Sitemap line comes from the runtime siteUrl.
export const dynamic = 'force-dynamic'

export default async function robots() {
  const seo = await loadGlobalSeo()
  const sitemap = seo.siteUrl ? `${seo.siteUrl.replace(/\/$/, '')}/sitemap.xml` : undefined

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap,
  }
}
