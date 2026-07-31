import 'server-only'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { and, eq, gt } from 'drizzle-orm'
import { db, ensureSchema } from './db'
import { auditLog, estimateApprovalLinks, records } from './schema'

type Data = Record<string, any> & { id: string }
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

async function record(kind: string, id: string, shopId: string) {
  const [row] = await db.select().from(records).where(and(eq(records.kind, kind), eq(records.id, id), eq(records.shopId, shopId))).limit(1)
  return row ? JSON.parse(row.data) as Data : null
}

export async function createEstimateApprovalLink(input: { shopId: string; orderId: string; actorId: string; expiresInDays: number }) {
  await ensureSchema()
  const order = await record('orders', input.orderId, input.shopId)
  if (!order) throw new Error('Repair order not found.')
  if (!Array.isArray(order.jobs) || order.jobs.length === 0) throw new Error('Add at least one service job before sharing this estimate.')
  const token = randomBytes(32).toString('base64url')
  const now = Date.now(), expiresAt = now + input.expiresInDays * 86400000
  await db.insert(estimateApprovalLinks).values({
    id: randomUUID(), shopId: input.shopId, orderId: input.orderId, tokenHash: digest(token), status: 'Open',
    createdBy: input.actorId, expiresAt, createdAt: now, respondedAt: null
  })
  await db.insert(auditLog).values({ actor: input.actorId, action: 'share_estimate', entity: 'orders', entityId: input.orderId, detail: `Created customer approval link expiring ${new Date(expiresAt).toISOString()}`, createdAt: now })
  return { token, expiresAt }
}

export async function getEstimateApproval(token: string) {
  await ensureSchema()
  const [link] = await db.select().from(estimateApprovalLinks).where(eq(estimateApprovalLinks.tokenHash, digest(token))).limit(1)
  if (!link) return { state: 'invalid' as const }
  if (link.expiresAt <= Date.now()) return { state: 'expired' as const }
  const order = await record('orders', link.orderId, link.shopId)
  if (!order) return { state: 'invalid' as const }
  const [customer, vehicle, shop] = await Promise.all([
    record('customers', String(order.customerId), link.shopId), record('vehicles', String(order.vehicleId), link.shopId),
    db.select().from(records).where(and(eq(records.kind, 'shops'), eq(records.shopId, link.shopId))).limit(1).then(rows => rows[0] ? JSON.parse(rows[0].data) as Data : null)
  ])
  if (!customer || !vehicle) return { state: 'invalid' as const }
  return {
    state: link.status === 'Responded' ? 'responded' as const : 'open' as const,
    expiresAt: link.expiresAt,
    shop: { name: shop?.name || 'GarageOS repair shop', phone: shop?.phone || '', address: shop?.address || '' },
    customer: { name: customer.name },
    vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model, plate: vehicle.plate, mileage: vehicle.mileage },
    order: {
      id: order.id, taxRate: Number(order.taxRate || 0), fees: Number(order.fees || 0), discount: Number(order.discount || 0),
      jobs: (order.jobs || []).map((job: Data) => ({ id: job.id, name: job.name, type: job.type, laborHours: Number(job.laborHours || 0), laborRate: Number(job.laborRate || 0), partsPrice: Number(job.partsPrice || 0), decision: job.decision || 'Pending', severity: job.severity || 'Monitor' }))
    }
  }
}

export async function respondToEstimate(token: string, decisions: { jobId: string; decision: 'Approved' | 'Declined' }[], customerName: string) {
  await ensureSchema()
  const now = Date.now()
  return db.transaction(async tx => {
    const [link] = await tx.select().from(estimateApprovalLinks).where(and(eq(estimateApprovalLinks.tokenHash, digest(token)), eq(estimateApprovalLinks.status, 'Open'), gt(estimateApprovalLinks.expiresAt, now))).for('update').limit(1)
    if (!link) throw new Error('This approval link is invalid, expired, or has already been submitted.')
    const [row] = await tx.select().from(records).where(and(eq(records.kind, 'orders'), eq(records.id, link.orderId), eq(records.shopId, link.shopId))).for('update').limit(1)
    if (!row) throw new Error('Repair order not found.')
    const order = JSON.parse(row.data) as Data
    const allowed = new Map(decisions.map(item => [item.jobId, item.decision]))
    const jobs = (order.jobs || []).map((job: Data) => allowed.has(job.id) ? { ...job, decision: allowed.get(job.id) } : job)
    const matched = jobs.filter((job: Data) => allowed.has(job.id)).length
    if (!matched || matched !== decisions.length) throw new Error('One or more estimate items are no longer available.')
    const anyApproved = jobs.some((job: Data) => job.decision === 'Approved')
    const authorization = { id: randomUUID(), channel: 'Secure customer portal', customerName, decisions, createdAt: new Date(now).toISOString() }
    const updated = { ...order, jobs, status: anyApproved && order.status === 'Estimate' ? 'Authorized' : order.status, authorizations: [...(order.authorizations || []), authorization] }
    await tx.update(records).set({ data: JSON.stringify(updated), updatedAt: now }).where(and(eq(records.id, row.id), eq(records.shopId, link.shopId)))
    await tx.update(estimateApprovalLinks).set({ status: 'Responded', respondedAt: now }).where(eq(estimateApprovalLinks.id, link.id))
    await tx.insert(auditLog).values({ actor: `customer:${customerName}`, action: 'estimate_response', entity: 'orders', entityId: link.orderId, detail: `Customer submitted ${decisions.filter(x => x.decision === 'Approved').length} approval(s) and ${decisions.filter(x => x.decision === 'Declined').length} decline(s)`, createdAt: now })
    return { orderId: link.orderId }
  })
}
