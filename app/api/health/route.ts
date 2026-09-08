import {NextResponse} from 'next/server'
import {sql} from '@/lib/db'

export const dynamic='force-dynamic'

export async function GET(){
 const started=Date.now()
 try{
  await sql`select 1 as healthy`
  return NextResponse.json({status:'healthy',database:'connected',version:process.env.APP_VERSION||'development',region:process.env.DEPLOYMENT_REGION||'local',checkedAt:new Date().toISOString(),latencyMs:Date.now()-started},{headers:{'cache-control':'no-store'}})
 }catch{
  return NextResponse.json({status:'unhealthy',database:'unavailable',checkedAt:new Date().toISOString(),latencyMs:Date.now()-started},{status:503,headers:{'cache-control':'no-store'}})
 }
}
