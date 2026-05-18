import { notFound } from 'next/navigation'
import { loadAdminConfig, loadGlobalHome, loadCookieConfig } from '../../lib/security.mjs'
import Header from '../Header'
import AdminShell from './AdminShell.js'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const [adminConfig, globalHome, cookieConfig] = await Promise.all([loadAdminConfig(), loadGlobalHome(), loadCookieConfig()])
  if (!adminConfig) notFound()

  let homeUrl = null
  if (globalHome === 'site' || globalHome == null) homeUrl = '/'
  else if (typeof globalHome === 'string' && globalHome !== 'folder' && globalHome !== false) homeUrl = globalHome

  return (
    <>
      <Header homeUrl={homeUrl} />
      <div className="page-layout no-toc">
        <article className="markdown-body">
          <AdminShell cookieConfig={cookieConfig?.storeAdmin ? cookieConfig : undefined} />
        </article>
      </div>
    </>
  )
}
