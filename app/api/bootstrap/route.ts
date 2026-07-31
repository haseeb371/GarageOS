import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { records, auditLog } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export async function GET() {
  const user=await currentUser()
  if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const rows=await db.select().from(records).where(eq(records.shopId,user.shopId))
  const state:Record<string,unknown[]>={}
  for(const row of rows) (state[row.kind]??=[]).push(JSON.parse(row.data))
  const audit=(await db.select().from(auditLog).where(eq(auditLog.actor,user.id))).slice(-100).reverse()
  return NextResponse.json({state,audit,session:user})
}
