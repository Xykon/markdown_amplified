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
  const analytics = await loadAnalyticsConfig()

  const consentInit = analytics ? `
window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{'analytics_storage':'denied','wait_for_update':500});
try{if(localStorage.getItem('ma_cookie_consent')==='granted')gtag('consent','update',{'analytics_storage':'granted'});}catch(e){}
` : null

  const gtagConfig = analytics ? `gtag('js',new Date());gtag('config','${analytics.gaId}');` : null

  return (
    <html lang="en">
      <head>
        {analytics && <>
          <script dangerouslySetInnerHTML={{ __html: consentInit }} />
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${analytics.gaId}`} />
          <script dangerouslySetInnerHTML={{ __html: gtagConfig }} />
        </>}
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        {analytics?.consentBanner && <CookieBanner privacyUrl={analytics.privacyUrl} privacyLabel={analytics.privacyLabel} />}
      </body>
    </html>
  )
}
