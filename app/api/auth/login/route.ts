import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db,ensureSchema } from '@/lib/db'
import { authUsers } from '@/lib/schema'
import { createSession,verifyPassword } from '@/lib/auth'
import { rateLimitByIp } from '@/lib/security'
import { storeCode } from '@/lib/authCodes'
import { sendEmail } from '@/lib/email'
const input=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(1).max(128)})
export async function POST(req:Request){await ensureSchema();const rl=await rateLimitByIp('login',10,60_000);if(!rl.ok)return NextResponse.json({error:'Too many sign-in attempts. Wait a minute and try again.'},{status:429,headers:{'Retry-After':String(Math.ceil((rl.resetAt-Date.now())/1000))}});const p=input.safeParse(await req.json());if(!p.success)return NextResponse.json({error:'Invalid credentials'},{status:400});const [u]=await db.select().from(authUsers).where(eq(authUsers.email,p.data.email)).limit(1);if(!u||!u.active||!verifyPassword(p.data.password,u.passwordHash))return NextResponse.json({error:'Invalid credentials'},{status:401});if(!u.emailVerified)return NextResponse.json({error:'Please verify your email first. Check your inbox for the verification code.'},{status:403});if(u.twoFactorEnabled){const code=await storeCode(u.email,'two-factor');if(code){await sendEmail({to:u.email,subject:'AutoGaragify — sign-in code',html:`<p>Your sign-in code is:</p><h2 style="font-size:32px;letter-spacing:6px;color:#176448">${code}</h2><p>Enter this code to complete sign-in. It expires in 10 minutes.</p><p style="color:#68736d;font-size:13px">If you didn't try to sign in, change your password immediately.</p>`})}return NextResponse.json({ok:true,requiresTwoFactor:true,email:u.email})}await createSession(u.id);return NextResponse.json({ok:true})}
