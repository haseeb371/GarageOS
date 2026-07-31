import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { authUsers } from '@/lib/schema'
import { currentUser } from '@/lib/auth'
import LoginForm from './LoginForm'
export const dynamic = 'force-dynamic'
export default async function Login({searchParams}:{searchParams:Promise<{mode?:string}>}){
 if(await currentUser())redirect('/')
 const hasUsers=Boolean((await db.select().from(authUsers).limit(1))[0])
 const requested=(await searchParams).mode
 return <LoginForm configured={hasUsers||requested==='login'} canCreate={!hasUsers}/>
}
