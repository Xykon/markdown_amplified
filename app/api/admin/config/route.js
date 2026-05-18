import { NextResponse } from 'next/server'
import { requireAdminAuth } from '../../../../lib/admin-auth.mjs'

export const dynamic = 'force-dynamic'

// GET /api/admin/config  — returns current admin config visible to the client
export async function GET(request) {
  const adminConfig = await requireAdminAuth(request)
  if (!adminConfig) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ readonly: adminConfig.readonly === true })
}
