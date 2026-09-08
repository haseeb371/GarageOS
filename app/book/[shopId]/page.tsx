import {and,eq} from 'drizzle-orm'
import {notFound} from 'next/navigation'
import {db} from '@/lib/db'
import {records} from '@/lib/schema'
import BookingForm from './BookingForm'
export const dynamic='force-dynamic'
export default async function BookingPage({params}:{params:Promise<{shopId:string}>}){const{shopId}=await params,[row]=await db.select().from(records).where(and(eq(records.id,shopId),eq(records.kind,'shops'))).limit(1);if(!row)notFound();return <BookingForm shopId={row.shopId} shop={JSON.parse(row.data)}/>}
