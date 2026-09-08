import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db,ensureSchema } from '@/lib/db'
import { authUsers } from '@/lib/schema'
import { createSession,verifyPassword } from '@/lib/auth'
import { rateLimitByIp } from '@/lib/security'
const input=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(1).max(128)})
export async function POST(req:Request){await ensureSchema();const rl=await rateLimitByIp('login',10,60_000);if(!rl.ok)return NextResponse.json({error:'Too many sign-in attempts. Wait a minute and try again.'},{status:429,headers:{'Retry-After':String(Math.ceil((rl.resetAt-Date.now())/1000))}});const p=input.safeParse(await req.json());if(!p.success)return NextResponse.json({error:'Invalid credentials'},{status:400});const [u]=await db.select().from(authUsers).where(eq(authUsers.email,p.data.email)).limit(1);if(!u||!u.active||!verifyPassword(p.data.password,u.passwordHash))return NextResponse.json({error:'Invalid credentials'},{status:401});await createSession(u.id);return NextResponse.json({ok:true})}
