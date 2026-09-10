import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, ensureSchema } from '@/lib/db'
import { authUsers } from '@/lib/schema'
import { currentUser } from '@/lib/auth'
import { storeCode } from '@/lib/authCodes'
import { sendEmail } from '@/lib/email'

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [u] = await db.select().from(authUsers).where(eq(authUsers.id, user.id)).limit(1)
  if (!u) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  return NextResponse.json({ twoFactorEnabled: u.twoFactorEnabled, emailVerified: u.emailVerified })
}

export async function POST(req: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { enable, verifyCode: code } = await req.json().catch(() => ({ enable: false, verifyCode: '' }))

  const [u] = await db.select().from(authUsers).where(eq(authUsers.id, user.id)).limit(1)
  if (!u) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  if (enable && !u.emailVerified) {
    return NextResponse.json({ error: 'Verify your email before enabling 2FA.' }, { status: 400 })
  }

  if (enable && !u.twoFactorEnabled) {
    if (code) {
      const { verifyCode } = await import('@/lib/authCodes')
      const valid = await verifyCode(u.email, '2fa-setup', String(code))
      if (!valid) return NextResponse.json({ error: 'Invalid or expired verification code.' }, { status: 400 })
      await db.update(authUsers).set({ twoFactorEnabled: true, updatedAt: Date.now() }).where(eq(authUsers.id, u.id))
      return NextResponse.json({ ok: true, twoFactorEnabled: true, message: '2FA is now enabled. You will receive a code by email on every sign-in.' })
    }
    const generated = await storeCode(u.email, '2fa-setup')
    if (generated) {
      await sendEmail({
        to: u.email,
        subject: 'AutoGaragify — confirm 2FA setup',
        html: `<p>Confirm enabling two-factor authentication. Your code is:</p><h2 style="font-size:32px;letter-spacing:6px;color:#176448">${generated}</h2><p>Enter this code in the settings to confirm.</p>`
      })
    }
    return NextResponse.json({ ok: true, requiresCode: true, message: 'Enter the code sent to your email to confirm enabling 2FA.' })
  }

  if (!enable && u.twoFactorEnabled) {
    await db.update(authUsers).set({ twoFactorEnabled: false, updatedAt: Date.now() }).where(eq(authUsers.id, u.id))
    return NextResponse.json({ ok: true, twoFactorEnabled: false, message: '2FA disabled.' })
  }

  return NextResponse.json({ ok: true, twoFactorEnabled: u.twoFactorEnabled })
}
