import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'

export const runtime = 'nodejs'

function config() {
  const raw = process.env.CLOUDINARY_URL
  if (!raw) throw new Error('Cloudinary storage is not configured.')
  const url = new URL(raw)
  if (url.protocol !== 'cloudinary:') throw new Error('CLOUDINARY_URL is invalid.')
  return { apiKey: decodeURIComponent(url.username), apiSecret: decodeURIComponent(url.password), cloudName: url.hostname }
}

const signature = (params: Record<string,string|number>, secret: string) => {
  const value = Object.entries(params).sort(([a],[b]) => a.localeCompare(b)).map(([key,val]) => `${key}=${val}`).join('&')
  return createHash('sha1').update(value + secret).digest('hex')
}

export async function POST(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const input = await request.formData(), file = input.get('file'), inspectionId = String(input.get('inspectionId') || '').replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(file instanceof File) || !inspectionId) return NextResponse.json({ error: 'Choose a file and inspection first.' }, { status: 400 })
    if (!/^image\//.test(file.type) && !/^video\//.test(file.type)) return NextResponse.json({ error: 'Only image and video files are allowed.' }, { status: 415 })
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'Files must be 20 MB or smaller.' }, { status: 413 })
    const { apiKey,apiSecret,cloudName } = config(), timestamp = Math.floor(Date.now()/1000), folder = `garageos/${user.shopId}/inspections/${inspectionId}`
    const body = new FormData()
    body.set('file',file);body.set('api_key',apiKey);body.set('timestamp',String(timestamp));body.set('folder',folder);body.set('signature',signature({folder,timestamp},apiSecret))
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,{method:'POST',body,signal:AbortSignal.timeout(45000)})
    const result = await response.json() as Record<string,any>
    if (!response.ok) throw new Error(result.error?.message || 'Cloudinary upload failed.')
    return NextResponse.json({ attachment:{ id:result.asset_id,publicId:result.public_id,name:file.name,type:file.type,size:file.size,width:result.width||null,height:result.height||null,duration:result.duration||null,resourceType:result.resource_type,url:result.secure_url,thumbnailUrl:result.resource_type==='image'?result.secure_url.replace('/upload/','/upload/c_fill,w_320,h_200,q_auto,f_auto/'):null,addedAt:new Date().toISOString() } })
  } catch (error) { return NextResponse.json({ error:error instanceof Error?error.message:'Upload failed.' },{status:502}) }
}

export async function DELETE(request: Request) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error:'Unauthorized' },{status:401})
  try {
    const { publicId,resourceType } = await request.json() as {publicId?:string;resourceType?:string}
    if (!publicId || !publicId.startsWith(`garageos/${user.shopId}/`)) return NextResponse.json({error:'Invalid attachment.'},{status:400})
    const {apiKey,apiSecret,cloudName}=config(),timestamp=Math.floor(Date.now()/1000),body=new URLSearchParams()
    body.set('public_id',publicId);body.set('timestamp',String(timestamp));body.set('api_key',apiKey);body.set('signature',signature({public_id:publicId,timestamp},apiSecret))
    const type=resourceType==='video'?'video':'image',response=await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`,{method:'POST',body,signal:AbortSignal.timeout(20000)})
    const result=await response.json() as Record<string,any>
    if(!response.ok||!['ok','not found'].includes(result.result))throw new Error(result.error?.message||'Cloudinary delete failed.')
    return NextResponse.json({ok:true})
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Delete failed.'},{status:502})}
}
