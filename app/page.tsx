import GarageApp from './ui/GarageApp'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
export const dynamic = 'force-dynamic'
export default async function Page(){const user=await currentUser();if(!user)redirect('/login');return <GarageApp session={user}/>}
