import './globals.css'
import 'katex/dist/katex.min.css'
// Site themes. Every registered theme ships in the bundle (the app router cannot import CSS
// conditionally); each file is scoped under html[data-palette='<name>'] and inert elsewhere.
import './themes/base.css'
import './themes/hljs.css'
import { ThemeProvider } from './ThemeContext'
import { loadAnalyticsConfig, loadGlobalSeo, loadGlobalSiteHeader, loadThemeConfig } from '../lib/security.mjs'
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
  // The site theme ("theme" in content-security.json) goes on <html> in the server HTML, so the
  // first paint already has its palette. data-theme stays the visitor's light/dark mode
  // (ThemeContext); without a theme the attribute is left out and the page is as before.
  const [analytics, theme] = await Promise.all([loadAnalyticsConfig(), loadThemeConfig()])

  return (
    <html lang="en" {...(theme ? { 'data-palette': theme } : {})}>
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
