import { notFound } from 'next/navigation'
import { loadAdminConfig, loadGlobalHome, loadGlobalSiteHeader, loadCookieConfig } from '../../lib/security.mjs'
import Header from '../Header'
import AdminShell from './AdminShell.js'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const [adminConfig, globalHome, cookieConfig, globalSiteHeader] = await Promise.all([loadAdminConfig(), loadGlobalHome(), loadCookieConfig(), loadGlobalSiteHeader()])
  if (!adminConfig) notFound()

  let homeUrl = null
  if (globalHome === 'site' || globalHome == null) homeUrl = '/'
  else if (typeof globalHome === 'string' && globalHome !== 'folder' && globalHome !== false) homeUrl = globalHome

  return (
    <>
      <Header homeUrl={homeUrl} siteName={globalSiteHeader.name} siteBanner={globalSiteHeader.banner ?? undefined} siteBannerLight={globalSiteHeader.bannerLight ?? undefined} siteBannerDark={globalSiteHeader.bannerDark ?? undefined} siteButton={globalSiteHeader.siteButton ?? undefined} />
      <div className="page-layout no-toc">
        <article className="markdown-body">
          <AdminShell cookieConfig={cookieConfig?.storeAdmin ? cookieConfig : undefined} />
        </article>
      </div>
    </>
  )
}
