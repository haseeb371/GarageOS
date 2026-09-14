import CustomerPortal from './CustomerPortal'

export const metadata = {
  title: 'Your visit | AutoGaragify',
  robots: { index: false, follow: false }
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <CustomerPortal token={token} />
}
