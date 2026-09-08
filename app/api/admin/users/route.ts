import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { and,eq,ne } from 'drizzle-orm'
import { z } from 'zod'
import { currentUser,hashPassword } from '@/lib/auth'
import { db,ensureSchema } from '@/lib/db'
import { auditLog,authUsers,sessions } from '@/lib/schema'

const roles=['Owner','Manager','Advisor','Technician','Bookkeeper'] as const
const createInput=z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().toLowerCase().email(),role:z.enum(roles),password:z.string().min(8).max(128)})
const updateInput=z.object({id:z.string().min(1),name:z.string().trim().min(2).max(100),role:z.enum(roles),active:z.boolean(),password:z.string().min(8).max(128).optional().or(z.literal(''))})
const denied=()=>NextResponse.json({error:'Only an owner or manager can manage employee accounts.'},{status:403})

export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401});if(!['Owner','Manager'].includes(actor.role))return denied()
 const parsed=createInput.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||'Invalid employee details.'},{status:400})
 if(actor.role!=='Owner'&&parsed.data.role==='Owner')return NextResponse.json({error:'Only an owner can create another owner.'},{status:403})
 await ensureSchema();const now=Date.now(),id=randomUUID()
 try{await db.transaction(async tx=>{await tx.insert(authUsers).values({id,shopId:actor.shopId,email:parsed.data.email,name:parsed.data.name,role:parsed.data.role,passwordHash:hashPassword(parsed.data.password),active:true,createdAt:now,updatedAt:now});await tx.insert(auditLog).values({actor:actor.id,action:'create_user',entity:'authUsers',entityId:id,detail:`Created ${parsed.data.role} account for ${parsed.data.email}`,createdAt:now})});return NextResponse.json({ok:true})}catch(error){return NextResponse.json({error:error instanceof Error&&error.message.includes('unique')?'That email already has an account.':'Could not create employee account.'},{status:400})}
}

export async function PATCH(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401});if(!['Owner','Manager'].includes(actor.role))return denied()
 const parsed=updateInput.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||'Invalid employee details.'},{status:400});await ensureSchema()
 const [target]=await db.select().from(authUsers).where(and(eq(authUsers.id,parsed.data.id),eq(authUsers.shopId,actor.shopId))).limit(1);if(!target)return NextResponse.json({error:'Employee account not found.'},{status:404})
 if(actor.role!=='Owner'&&(target.role==='Owner'||parsed.data.role==='Owner'))return NextResponse.json({error:'Managers cannot change owner accounts.'},{status:403})
 if(target.id===actor.id&&!parsed.data.active)return NextResponse.json({error:'You cannot deactivate your own account.'},{status:400})
 if(target.role==='Owner'&&(parsed.data.role!=='Owner'||!parsed.data.active)){const owners=await db.select({id:authUsers.id}).from(authUsers).where(and(eq(authUsers.shopId,actor.shopId),eq(authUsers.role,'Owner'),eq(authUsers.active,true),ne(authUsers.id,target.id)));if(!owners.length)return NextResponse.json({error:'The shop must retain at least one active owner.'},{status:400})}
 const now=Date.now(),changes:any={name:parsed.data.name,role:parsed.data.role,active:parsed.data.active,updatedAt:now};if(parsed.data.password)changes.passwordHash=hashPassword(parsed.data.password)
 await db.transaction(async tx=>{await tx.update(authUsers).set(changes).where(eq(authUsers.id,target.id));if(!parsed.data.active||parsed.data.password)await tx.delete(sessions).where(eq(sessions.userId,target.id));await tx.insert(auditLog).values({actor:actor.id,action:parsed.data.active?'update_user':'disable_user',entity:'authUsers',entityId:target.id,detail:`Updated ${target.email}: role ${target.role} → ${parsed.data.role}${parsed.data.password?' and reset password':''}`,createdAt:now})});return NextResponse.json({ok:true})
}
