import './globals.css'
export const metadata={title:'AutoGaragify',description:'Independent auto shop operations',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'AutoGaragify',statusBarStyle:'default'}}
export const viewport={themeColor:'#176448',width:'device-width',initialScale:1,maximumScale:5}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
