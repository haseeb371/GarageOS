import { Suspense } from 'react'
import FinancingDemoClient from './FinancingDemoClient'

export const dynamic = 'force-dynamic'

export default function FinancingDemoPage() {
  return (
    <Suspense
      fallback={
        <main className="estimate-public">
          <section className="estimate-message">
            <div className="estimate-spinner" />
            <h1>Loading financing options…</h1>
          </section>
        </main>
      }
    >
      <FinancingDemoClient />
    </Suspense>
  )
}
