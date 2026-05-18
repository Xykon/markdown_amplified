import { NextResponse } from 'next/server'
import { loadAdminConfig } from '../../../../lib/security.mjs'
import { createToken, safeEqual } from '../../../../lib/admin-auth.mjs'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const adminConfig = await loadAdminConfig()
  if (!adminConfig) return NextResponse.json({ error: 'Admin not enabled' }, { status: 403 })

  const submitted = typeof body.password === 'string' ? body.password : ''
  if (!safeEqual(submitted, adminConfig.password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  return NextResponse.json({ token: createToken(adminConfig.password), readonly: adminConfig.readonly === true })
}
