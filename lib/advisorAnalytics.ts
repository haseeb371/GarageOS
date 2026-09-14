import { jobValue } from './marketing'

type Row = Record<string, unknown> & { id: string }

export type AdvisorPeriodStats = {
  advisor: string
  orders: number
  jobsRecommended: number
  jobsApproved: number
  jobsDeclined: number
  jobsPending: number
  recommendedDollars: number
  approvedDollars: number
  declinedDollars: number
  /** Approved $ / recommended $ (0–100). */
  closeRate: number
  /** Approved $ / orders with at least one decided job. */
  aro: number
}

export type AdvisorCompareRow = AdvisorPeriodStats & {
  priorCloseRate: number | null
  priorAro: number | null
  closeRateDelta: number | null
  aroDelta: number | null
}

function stamp(value: unknown) {
  return String(value || '').slice(0, 10)
}

export function orderActivityDate(order: Row) {
  return stamp(order.completedAt || order.authorizedAt || order.updatedAt || order.createdAt || order.date)
}

export function inDateRange(date: string, from: string, to: string) {
  if (!date) return false
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

/** Previous period of equal length immediately before `from`. */
export function priorPeriod(from: string, to: string) {
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const priorEnd = new Date(start)
  priorEnd.setDate(priorEnd.getDate() - 1)
  const priorStart = new Date(priorEnd)
  priorStart.setDate(priorStart.getDate() - (days - 1))
  return {
    from: priorStart.toISOString().slice(0, 10),
    to: priorEnd.toISOString().slice(0, 10),
    days
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function advisorPerformance(orders: Row[] = [], from: string, to: string): AdvisorPeriodStats[] {
  const byAdvisor = new Map<
    string,
    {
      orders: Set<string>
      decidedOrders: Set<string>
      jobsRecommended: number
      jobsApproved: number
      jobsDeclined: number
      jobsPending: number
      recommendedDollars: number
      approvedDollars: number
      declinedDollars: number
    }
  >()

  for (const order of orders) {
    const date = orderActivityDate(order)
    if (!inDateRange(date, from, to)) continue
    const advisor = String(order.advisor || 'Unassigned').trim() || 'Unassigned'
    let bucket = byAdvisor.get(advisor)
    if (!bucket) {
      bucket = {
        orders: new Set(),
        decidedOrders: new Set(),
        jobsRecommended: 0,
        jobsApproved: 0,
        jobsDeclined: 0,
        jobsPending: 0,
        recommendedDollars: 0,
        approvedDollars: 0,
        declinedDollars: 0
      }
      byAdvisor.set(advisor, bucket)
    }
    bucket.orders.add(String(order.id))
    const jobs = Array.isArray(order.jobs) ? (order.jobs as Row[]) : []
    let decided = false
    for (const job of jobs) {
      const value = jobValue(job)
      bucket.jobsRecommended += 1
      bucket.recommendedDollars += value
      const decision = String(job.decision || 'Pending')
      if (decision === 'Approved') {
        bucket.jobsApproved += 1
        bucket.approvedDollars += value
        decided = true
      } else if (decision === 'Declined') {
        bucket.jobsDeclined += 1
        bucket.declinedDollars += value
        decided = true
      } else {
        bucket.jobsPending += 1
      }
    }
    if (decided) bucket.decidedOrders.add(String(order.id))
  }

  return Array.from(byAdvisor.entries())
    .map(([advisor, b]) => {
      const recommendedDollars = round2(b.recommendedDollars)
      const approvedDollars = round2(b.approvedDollars)
      const declinedDollars = round2(b.declinedDollars)
      const closeRate = recommendedDollars > 0 ? (approvedDollars / recommendedDollars) * 100 : 0
      const orderCount = b.decidedOrders.size || b.orders.size
      const aro = orderCount > 0 ? approvedDollars / orderCount : 0
      return {
        advisor,
        orders: b.orders.size,
        jobsRecommended: b.jobsRecommended,
        jobsApproved: b.jobsApproved,
        jobsDeclined: b.jobsDeclined,
        jobsPending: b.jobsPending,
        recommendedDollars,
        approvedDollars,
        declinedDollars,
        closeRate: round2(closeRate),
        aro: round2(aro)
      }
    })
    .sort((a, b) => b.approvedDollars - a.approvedDollars || a.advisor.localeCompare(b.advisor))
}

export function advisorPerformanceCompare(orders: Row[] = [], from: string, to: string): {
  current: AdvisorPeriodStats[]
  prior: AdvisorPeriodStats[]
  priorRange: { from: string; to: string; days: number }
  rows: AdvisorCompareRow[]
  totals: AdvisorCompareRow
} {
  const priorRange = priorPeriod(from, to)
  const current = advisorPerformance(orders, from, to)
  const prior = advisorPerformance(orders, priorRange.from, priorRange.to)
  const priorBy = new Map(prior.map(row => [row.advisor, row]))

  const rows: AdvisorCompareRow[] = current.map(row => {
    const p = priorBy.get(row.advisor)
    return {
      ...row,
      priorCloseRate: p ? p.closeRate : null,
      priorAro: p ? p.aro : null,
      closeRateDelta: p ? round2(row.closeRate - p.closeRate) : null,
      aroDelta: p ? round2(row.aro - p.aro) : null
    }
  })

  const sum = (list: AdvisorPeriodStats[], key: keyof AdvisorPeriodStats) =>
    list.reduce((s, row) => s + Number(row[key] || 0), 0)

  const recommendedDollars = round2(sum(current, 'recommendedDollars'))
  const approvedDollars = round2(sum(current, 'approvedDollars'))
  const priorRecommended = round2(sum(prior, 'recommendedDollars'))
  const priorApproved = round2(sum(prior, 'approvedDollars'))
  const closeRate = recommendedDollars > 0 ? (approvedDollars / recommendedDollars) * 100 : 0
  const priorClose = priorRecommended > 0 ? (priorApproved / priorRecommended) * 100 : 0
  const ordersCount = sum(current, 'orders')
  const priorOrders = sum(prior, 'orders')
  const aro = ordersCount > 0 ? approvedDollars / ordersCount : 0
  const priorAro = priorOrders > 0 ? priorApproved / priorOrders : 0

  const totals: AdvisorCompareRow = {
    advisor: 'Shop total',
    orders: ordersCount,
    jobsRecommended: sum(current, 'jobsRecommended'),
    jobsApproved: sum(current, 'jobsApproved'),
    jobsDeclined: sum(current, 'jobsDeclined'),
    jobsPending: sum(current, 'jobsPending'),
    recommendedDollars,
    approvedDollars,
    declinedDollars: round2(sum(current, 'declinedDollars')),
    closeRate: round2(closeRate),
    aro: round2(aro),
    priorCloseRate: round2(priorClose),
    priorAro: round2(priorAro),
    closeRateDelta: round2(closeRate - priorClose),
    aroDelta: round2(aro - priorAro)
  }

  return { current, prior, priorRange, rows, totals }
}

export function advisorPerformanceCsv(
  compare: ReturnType<typeof advisorPerformanceCompare>,
  from: string,
  to: string
) {
  const escape = (value: unknown) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }
  const header = [
    'Advisor',
    'Orders',
    'Jobs recommended',
    'Jobs approved',
    'Jobs declined',
    'Recommended $',
    'Approved $',
    'Declined $',
    'Close rate %',
    'Prior close rate %',
    'Close rate Δ',
    'ARO $',
    'Prior ARO $',
    'ARO Δ'
  ]
  const line = (row: AdvisorCompareRow) =>
    [
      row.advisor,
      row.orders,
      row.jobsRecommended,
      row.jobsApproved,
      row.jobsDeclined,
      row.recommendedDollars.toFixed(2),
      row.approvedDollars.toFixed(2),
      row.declinedDollars.toFixed(2),
      row.closeRate.toFixed(1),
      row.priorCloseRate == null ? '' : row.priorCloseRate.toFixed(1),
      row.closeRateDelta == null ? '' : row.closeRateDelta.toFixed(1),
      row.aro.toFixed(2),
      row.priorAro == null ? '' : row.priorAro.toFixed(2),
      row.aroDelta == null ? '' : row.aroDelta.toFixed(2)
    ]
      .map(escape)
      .join(',')

  return [
    `Period,${escape(from)} to ${escape(to)}`,
    `Prior period,${escape(compare.priorRange.from)} to ${escape(compare.priorRange.to)}`,
    '',
    header.join(','),
    ...compare.rows.map(line),
    line(compare.totals)
  ].join('\n')
}
