import './globals.css'
import 'katex/dist/katex.min.css'
import { ThemeProvider } from './ThemeContext'
import { loadAnalyticsConfig, loadGlobalSeo, loadGlobalSiteHeader } from '../lib/security.mjs'
import CookieBanner from './CookieBanner'

export async function generateMetadata() {
  const [{ name }, seo] = await Promise.all([loadGlobalSiteHeader(), loadGlobalSeo()])
  const siteName = name || 'Markdown Amplified'
  const metadataBase = seo.siteUrl ? new URL(seo.siteUrl) : null
  return {
    metadataBase,
    title: {
      template: `%s | ${siteName}`,
      default: siteName,
    },
    description: seo.defaultDescription || undefined,
  }
}

export default async function RootLayout({ children }) {
  // No Google script is part of the page: CookieBanner loads gtag.js in the browser only once the
  // visitor has accepted analytics (or at once when the site turns the banner off), so nothing
  // reaches Google before a choice.
  const analytics = await loadAnalyticsConfig()

  return (
    <html lang="en">
      <head />
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        {analytics && (
          <CookieBanner
            gaId={analytics.gaId}
            cookieDomain={analytics.cookieDomain}
            consentBanner={analytics.consentBanner}
            privacyUrl={analytics.privacyUrl}
            privacyLabel={analytics.privacyLabel}
          />
        )}
      </body>
    </html>
  )
}
