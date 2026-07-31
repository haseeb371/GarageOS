import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { db,ensureSchema } from '@/lib/db'
import { authUsers,auditLog,records } from '@/lib/schema'
import { createSession,hashPassword } from '@/lib/auth'
const input=z.object({shopName:z.string().trim().min(2).max(100),name:z.string().trim().min(2).max(100),email:z.string().trim().toLowerCase().email(),password:z.string().min(8).max(128)})
export async function POST(req:Request){
 try{
  await ensureSchema()
  if((await db.select().from(authUsers).limit(1))[0])return NextResponse.json({error:'GarageOS is already configured. Sign in instead.'},{status:409})
  const p=input.safeParse(await req.json())
  if(!p.success)return NextResponse.json({error:p.error.issues[0]?.message||'Please check all fields.'},{status:400})
  const n=Date.now(),uid=randomUUID(),sid=randomUUID()
  await db.transaction(async tx=>{
   await tx.delete(records);await tx.delete(auditLog)
   await tx.insert(authUsers).values({id:uid,shopId:sid,email:p.data.email,name:p.data.name,role:'Owner',passwordHash:hashPassword(p.data.password),active:true,createdAt:n,updatedAt:n})
   await tx.insert(records).values({id:sid,kind:'shops',shopId:sid,data:JSON.stringify({id:sid,name:p.data.shopName,address:'',phone:''}),createdAt:n,updatedAt:n})
   await tx.insert(auditLog).values({actor:uid,action:'setup',entity:'shop',entityId:sid,detail:'Created workspace',createdAt:n})
  })
  await createSession(uid)
  return NextResponse.json({ok:true})
 }catch(error){
  console.error('Workspace setup failed',error)
  return NextResponse.json({error:'Workspace creation failed. Please restart GarageOS and try again.'},{status:500})
 }
}
