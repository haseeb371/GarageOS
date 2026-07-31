import { db } from '@/lib/db'
import { records } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { currentUser } from '@/lib/auth'
export async function GET(){
 const user=await currentUser();if(!user)return new Response('Unauthorized',{status:401})
 const data=(await db.select().from(records).where(eq(records.shopId,user.shopId))).map(r=>({...r,data:JSON.parse(r.data)}))
 return new Response(JSON.stringify({version:1,exportedAt:new Date().toISOString(),records:data},null,2),{headers:{'content-type':'application/json','content-disposition':'attachment; filename=\"garageos-backup.json\"'}})
}
