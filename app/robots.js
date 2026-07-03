import { loadGlobalSeo } from '../lib/security.mjs'

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
