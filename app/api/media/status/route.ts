import { NextResponse } from 'next/server'

export async function GET() {
  const configured = Boolean(process.env.CLOUDINARY_URL?.trim())
  return NextResponse.json({
    configured,
    provider: 'Cloudinary',
    message: configured
      ? 'Inspection photo and video uploads are ready.'
      : 'Add CLOUDINARY_URL to .env.local to enable inspection media uploads.'
  })
}
