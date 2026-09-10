import {randomUUID} from 'crypto'
import {eq} from 'drizzle-orm'
import {NextResponse} from 'next/server'
import {z} from 'zod'
import {hashPassword} from '@/lib/auth'
import {db,ensureSchema} from '@/lib/db'
import {auditLog,authUsers,records} from '@/lib/schema'
import {defaultShopRecords} from '@/lib/shopDefaults'
import {rateLimitByIp} from '@/lib/security'
import {storeCode} from '@/lib/authCodes'
import {sendEmail} from '@/lib/email'

const input=z.object({shopName:z.string().trim().min(2).max(100),name:z.string().trim().min(2).max(100),email:z.string().trim().toLowerCase().email(),password:z.string().min(8).max(128)})

export async function POST(request:Request){
 try{
  await ensureSchema()
  const rl=await rateLimitByIp('register',5,60_000)
  if(!rl.ok)return NextResponse.json({error:'Too many sign-up attempts. Wait a minute and try again.'},{status:429,headers:{'Retry-After':String(Math.ceil((rl.resetAt-Date.now())/1000))}})
  const parsed=input.safeParse(await request.json())
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||'Please check all fields.'},{status:400})
  if((await db.select({id:authUsers.id}).from(authUsers).where(eq(authUsers.email,parsed.data.email)).limit(1))[0])return NextResponse.json({error:'An account already exists for this email. Sign in instead.'},{status:409})
  const now=Date.now(),userId=randomUUID(),shopId=randomUUID()
  await db.transaction(async tx=>{
   await tx.insert(authUsers).values({id:userId,shopId,email:parsed.data.email,name:parsed.data.name,role:'Owner',passwordHash:hashPassword(parsed.data.password),active:true,emailVerified:false,twoFactorEnabled:false,createdAt:now,updatedAt:now})
   await tx.insert(records).values({id:shopId,kind:'shops',shopId,data:JSON.stringify({id:shopId,name:parsed.data.shopName,address:'',phone:'',country:'',currency:'USD',locale:'en-US',timezone:'UTC',taxName:'Sales tax',taxRate:0,dateFormat:'MM/DD/YYYY',active:true}),createdAt:now,updatedAt:now})
   for (const row of defaultShopRecords(shopId, parsed.data.shopName, now)) {
    await tx.insert(records).values({ id: row.id, kind: row.kind, shopId, data: JSON.stringify(row.data), createdAt: now, updatedAt: now })
   }
   await tx.insert(auditLog).values({actor:userId,action:'register',entity:'shop',entityId:shopId,detail:'Created isolated buyer workspace with operational defaults',createdAt:now})
  })
  const code=await storeCode(parsed.data.email,'email-verification')
  if(code){
   await sendEmail({to:parsed.data.email,subject:'AutoGaragify — verify your email',html:`<p>Welcome to AutoGaragify!</p><p>Your verification code is:</p><h2 style="font-size:32px;letter-spacing:6px;color:#176448">${code}</h2><p>Enter this code to complete your account setup. It expires in 10 minutes.</p><p style="color:#68736d;font-size:13px">If you didn't create an account, ignore this email.</p>`})
  }
  return NextResponse.json({ok:true,requiresVerification:true,email:parsed.data.email})
 }catch(error){
  console.error('Account registration failed',error)
  return NextResponse.json({error:'Account creation failed. Please try again.'},{status:500})
 }
}
