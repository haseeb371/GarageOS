import { orderTotal } from './booking'

type Row = Record<string, unknown> & { id: string }

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function buildInvoiceEmailLog(invoice: Row, customer: Row, shopName: string) {
  return {
    id: `IT-${Date.now()}`,
    type: 'Invoice email',
    itemId: String(invoice.id),
    sku: String(invoice.orderId || ''),
    itemName: `Invoice ${invoice.id}`,
    quantity: 0,
    note: [
      `Sandbox email from ${shopName || 'AutoGragify'} would send invoice ${invoice.id} to ${customer.email || customer.phone || customer.name}:`,
      `Total ${invoice.total} · Balance ${invoice.balance} · Due ${invoice.due || 'not set'}`,
      'Connect RESEND_API_KEY and EMAIL_FROM for live delivery.'
    ].join('\n'),
    createdAt: new Date().toISOString()
  }
}

export function buildInvoicePrintHtml(
  invoice: Row,
  context: {
    shop?: Row
    customer?: Row
    order?: Row
    payments?: Row[]
  }
) {
  const shop = (context.shop || { name: 'AutoGragify' }) as Row
  const customer = (context.customer || { name: 'Customer' }) as Row
  const order = context.order
  const payments = (context.payments || []).filter(payment => payment.invoiceId === invoice.id)
  const jobs = order ? (Array.isArray(order.jobs) ? (order.jobs as Row[]) : []).filter(job => job.decision === 'Approved') : []
  const subtotal = jobs.reduce(
    (sum, job) => sum + Number(job.laborHours || 0) * Number(job.laborRate || 0) + Number(job.partsPrice || 0),
    0
  )
  const total = Number(invoice.total || (order ? orderTotal(order) : 0))
  const balance = Number(invoice.balance ?? total)

  const jobRows = jobs.length
    ? jobs
        .map(
          job => `<tr><td>${escapeHtml(job.name)}</td><td>${Number(job.laborHours || 0).toFixed(1)}h</td><td align="right">${Number(job.partsPrice || 0).toFixed(2)}</td><td align="right">${(Number(job.laborHours || 0) * Number(job.laborRate || 0) + Number(job.partsPrice || 0)).toFixed(2)}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="4">Invoice total from repair order ${escapeHtml(invoice.orderId || 'manual entry')}</td></tr>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(invoice.id)}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#13261e;margin:32px;line-height:1.45}
    h1{margin:0 0 4px;font-size:28px}.muted{color:#5f6d66;font-size:14px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:24px 0}
    table{width:100%;border-collapse:collapse;margin-top:18px}
    th,td{border-bottom:1px solid #d8e0d8;padding:10px 8px;text-align:left;font-size:14px}
    th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5f6d66}
    .totals{margin-top:18px;max-width:320px;margin-left:auto}
    .totals div{display:flex;justify-content:space-between;padding:6px 0}
    .totals b{font-size:18px}
    @media print{body{margin:18px}}
  </style></head><body>
    <h1>${escapeHtml(shop.name)}</h1>
    <div class="muted">${escapeHtml(shop.address || '')}${shop.phone ? ` · ${escapeHtml(shop.phone)}` : ''}</div>
    <div class="grid">
      <div><strong>Bill to</strong><br/>${escapeHtml(customer.name)}<br/>${escapeHtml(customer.email || '')}<br/>${escapeHtml(customer.phone || '')}</div>
      <div><strong>Invoice</strong><br/>${escapeHtml(invoice.id)}<br/>Issued ${escapeHtml(invoice.issuedAt || invoice.due || '')}<br/>Due ${escapeHtml(invoice.due || '')}${invoice.orderId ? `<br/>Repair order ${escapeHtml(invoice.orderId)}` : ''}</div>
    </div>
    <table><thead><tr><th>Service</th><th>Labor</th><th>Parts</th><th>Line total</th></tr></thead><tbody>${jobRows}</tbody></table>
    <div class="totals">
      ${order ? `<div><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>` : ''}
      <div><span>Invoice total</span><span>${total.toFixed(2)}</span></div>
      <div><span>Balance due</span><b>${balance.toFixed(2)}</b></div>
    </div>
    ${payments.length ? `<p class="muted">Payments recorded: ${payments.map(payment => `${payment.method} ${Number(payment.amount || 0).toFixed(2)}`).join(' · ')}</p>` : ''}
    ${invoice.notes ? `<p><strong>Notes</strong><br/>${escapeHtml(invoice.notes)}</p>` : ''}
  </body></html>`
}
