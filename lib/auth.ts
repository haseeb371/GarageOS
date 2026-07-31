import 'server-only'
import { cookies } from 'next/headers'
import { createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual } from 'crypto'
import { and,eq,gt } from 'drizzle-orm'
import { db,ensureSchema } from './db'
import { authUsers,sessions } from './schema'
const COOKIE='garageos_session', LIFE=1209600000
export type AuthUser={id:string;shopId:string;email:string;name:string;role:string}
export function hashPassword(p:string){const s=randomBytes(16).toString('hex');return `scrypt:${s}:${scryptSync(p,s,64).toString('hex')}`}
export function verifyPassword(p:string,v:string){const [a,s,h]=v.split(':');if(a!=='scrypt'||!s||!h)return false;const x=scryptSync(p,s,64),y=Buffer.from(h,'hex');return x.length===y.length&&timingSafeEqual(x,y)}
const digest=(t:string)=>createHash('sha256').update(t).digest('hex')
export async function createSession(userId:string){await ensureSchema();const t=randomBytes(32).toString('base64url'),n=Date.now();await db.insert(sessions).values({id:randomUUID(),userId,tokenHash:digest(t),expiresAt:n+LIFE,createdAt:n,lastSeenAt:n});(await cookies()).set(COOKIE,t,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:LIFE/1000})}
export async function destroySession(){await ensureSchema();const c=await cookies(),t=c.get(COOKIE)?.value;if(t)await db.delete(sessions).where(eq(sessions.tokenHash,digest(t)));c.set(COOKIE,'',{httpOnly:true,path:'/',maxAge:0})}
export async function currentUser():Promise<AuthUser|null>{await ensureSchema();const t=(await cookies()).get(COOKIE)?.value;if(!t)return null;const [r]=await db.select({s:sessions,u:authUsers}).from(sessions).innerJoin(authUsers,eq(sessions.userId,authUsers.id)).where(and(eq(sessions.tokenHash,digest(t)),gt(sessions.expiresAt,Date.now()),eq(authUsers.active,true))).limit(1);return r?{id:r.u.id,shopId:r.u.shopId,email:r.u.email,name:r.u.name,role:r.u.role}:null}
export const canWrite=(r:string)=>['Owner','Manager','Advisor','Bookkeeper'].includes(r)
