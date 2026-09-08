import {NextResponse} from 'next/server'
import {z} from 'zod'
import {db} from '@/lib/db'
import {auditLog,records} from '@/lib/schema'
import {currentUser} from '@/lib/auth'
import {kinds} from '@/lib/domain'
const record=z.object({id:z.string().min(1),kind:z.enum(kinds),data:z.record(z.string(),z.unknown())})
const input=z.object({version:z.number().optional(),records:z.array(record).min(1).max(10000)})
export async function POST(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});if(!['Owner','Manager'].includes(user.role))return NextResponse.json({error:'Only owners and managers can import backups.'},{status:403});const parsed=input.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:'This is not a valid AutoGaragify backup.'},{status:400});const now=Date.now();await db.transaction(async tx=>{for(const item of parsed.data.records){const clean={...item.data,id:item.id,shopId:user.shopId};await tx.insert(records).values({id:item.id,kind:item.kind,shopId:user.shopId,data:JSON.stringify(clean),createdAt:now,updatedAt:now}).onConflictDoUpdate({target:records.id,set:{kind:item.kind,shopId:user.shopId,data:JSON.stringify(clean),updatedAt:now}})}await tx.insert(auditLog).values({actor:user.id,action:'import_backup',entity:'records',entityId:'bulk',detail:`Imported ${parsed.data.records.length} records from backup`,createdAt:now})});return NextResponse.json({ok:true,imported:parsed.data.records.length})}
