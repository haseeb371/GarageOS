import 'server-only'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { buildFinancingOffer } from './financing'
import { and, eq } from 'drizzle-orm'
import { db, ensureSchema } from './db'
import { auditLog, customerPortalLinks, records } from './schema'

type Data = Record<string, any> & { id: string }
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  Estimate: {
    label: 'Estimate ready',
    detail: 'Your shop shared recommended services. Ask them for an estimate approval link if you still need to approve work.'
  },
  Authorized: {
    label: 'Approved — queued',
    detail: 'You authorized work. The shop will start when a bay and technician are available.'
  },
  'In progress': {
    label: 'In progress',
    detail: 'Technicians are working on your vehicle.'
  },
  Ready: {
    label: 'Ready for pickup',
    detail: 'Your vehicle is ready. Pay any open balance below, then head to the shop.'
  },
  Completed: {
    label: 'Completed',
    detail: 'This visit is complete. Outstanding invoices still appear below if anything remains unpaid.'
  }
}

async function record(kind: string, id: string, shopId: string) {
  const [row] = await db
    .select()
    .from(records)
    .where(and(eq(records.kind, kind), eq(records.id, id), eq(records.shopId, shopId)))
    .limit(1)
  return row ? (JSON.parse(row.data) as Data) : null
}

export async function createCustomerPortalLink(input: {
  shopId: string
  orderId: string
  actorId: string
  expiresInDays: number
}) {
  await ensureSchema()
  const order = await record('orders', input.orderId, input.shopId)
  if (!order) throw new Error('Repair order not found.')
  const customerId = String(order.customerId || '')
  if (!customerId) throw new Error('Repair order has no customer.')

  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = now + input.expiresInDays * 86400000
  await db.insert(customerPortalLinks).values({
    id: randomUUID(),
    shopId: input.shopId,
    orderId: input.orderId,
    customerId,
    tokenHash: digest(token),
    createdBy: input.actorId,
    expiresAt,
    createdAt: now
  })
  await db.insert(auditLog).values({
    actor: input.actorId,
    action: 'share_portal',
    entity: 'orders',
    entityId: input.orderId,
    detail: `Created customer portal link expiring ${new Date(expiresAt).toISOString()}`,
    createdAt: now
  })
  return { token, expiresAt }
}

export async function getCustomerPortal(token: string) {
  await ensureSchema()
  const [link] = await db
    .select()
    .from(customerPortalLinks)
    .where(eq(customerPortalLinks.tokenHash, digest(token)))
    .limit(1)
  if (!link) return { state: 'invalid' as const }
  if (link.expiresAt <= Date.now()) return { state: 'expired' as const }

  const order = await record('orders', link.orderId, link.shopId)
  if (!order) return { state: 'invalid' as const }

  const [customer, vehicle, shopRow] = await Promise.all([
    record('customers', String(order.customerId), link.shopId),
    record('vehicles', String(order.vehicleId), link.shopId),
    db
      .select()
      .from(records)
      .where(and(eq(records.kind, 'shops'), eq(records.shopId, link.shopId)))
      .limit(1)
      .then(rows => (rows[0] ? (JSON.parse(rows[0].data) as Data) : null))
  ])
  if (!customer) return { state: 'invalid' as const }

  const shopRows = await db.select().from(records).where(eq(records.shopId, link.shopId))
  const invoices = shopRows
    .filter(row => row.kind === 'invoices')
    .map(row => JSON.parse(row.data) as Data)
    .filter(
      inv =>
        String(inv.customerId) === String(order.customerId) &&
        (String(inv.orderId || '') === String(order.id) || Number(inv.balance || 0) > 0)
    )
    .map(inv => ({
      id: String(inv.id),
      orderId: String(inv.orderId || ''),
      status: String(inv.status || 'Open'),
      total: Number(inv.total || 0),
      balance: Number(inv.balance || 0),
      date: String(inv.date || '')
    }))

  const openInvoices = invoices.filter(inv => inv.balance > 0.005)
  const balanceDue = openInvoices.reduce((sum, inv) => sum + inv.balance, 0)
  const status = String(order.status || 'Estimate')
  const copy = STATUS_COPY[status] || {
    label: status,
    detail: 'Your shop will update this status as work progresses.'
  }

  const jobs = (order.jobs || []).map((job: Data) => ({
    id: String(job.id),
    name: String(job.name || 'Service'),
    decision: String(job.decision || 'Pending'),
    severity: String(job.severity || 'Monitor')
  }))

  const shopName = String(shopRow?.name || 'AutoGaragify repair shop')
  const financingAmount = Math.max(balanceDue, ...openInvoices.map(inv => inv.total), 0)
  const financing = buildFinancingOffer(financingAmount, shopName, openInvoices[0]?.id || String(order.id), {
    orderId: String(order.id),
    baseUrl: process.env.APP_URL
  })

  return {
    state: 'open' as const,
    expiresAt: link.expiresAt,
    shop: {
      name: shopName,
      phone: shopRow?.phone || '',
      address: shopRow?.address || '',
      currency: shopRow?.currency || 'USD'
    },
    customer: { name: String(customer.name || 'Customer') },
    vehicle: vehicle
      ? {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          plate: vehicle.plate || ''
        }
      : null,
    order: {
      id: String(order.id),
      status,
      statusLabel: copy.label,
      statusDetail: copy.detail,
      jobs
    },
    invoices: openInvoices,
    balanceDue,
    canPay: openInvoices.length > 0,
    financing
  }
}

export async function resolvePortalCheckoutInvoice(token: string, invoiceId?: string) {
  const portal = await getCustomerPortal(token)
  if (portal.state !== 'open') throw new Error('This portal link is invalid or expired.')
  const [link] = await db
    .select()
    .from(customerPortalLinks)
    .where(eq(customerPortalLinks.tokenHash, digest(token)))
    .limit(1)
  if (!link) throw new Error('This portal link is invalid or expired.')

  const targetId = invoiceId || portal.invoices[0]?.id
  if (!targetId) throw new Error('There is no outstanding balance to pay.')
  const invoice = portal.invoices.find(inv => inv.id === targetId)
  if (!invoice || invoice.balance <= 0) throw new Error('That invoice is not payable on this portal.')

  const customer = await record('customers', link.customerId, link.shopId)
  return {
    shopId: link.shopId,
    orderId: link.orderId,
    invoice,
    customerEmail: customer?.email ? String(customer.email) : undefined,
    customerName: customer?.name ? String(customer.name) : portal.customer.name,
    shopName: portal.shop.name,
    currency: String(portal.shop.currency || 'USD')
  }
}
