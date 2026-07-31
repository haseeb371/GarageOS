import EstimateApproval from './EstimateApproval'

export const metadata = { title: 'Review your estimate | GarageOS', robots: { index: false, follow: false } }
export default async function EstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <EstimateApproval token={token}/>
}
