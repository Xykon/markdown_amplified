import { notFound } from 'next/navigation'
import { loadAdminConfig } from '../../lib/security.mjs'
import AdminShell from './AdminShell.js'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const adminConfig = await loadAdminConfig()
  if (!adminConfig) notFound()
  return <AdminShell />
}
