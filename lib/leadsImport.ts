import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, contactLogs, salesLeads } from '@/lib/schema'
import {
  failuresToCsv,
  parseLeadCsv,
  planLeadImport,
  type LeadImportResult
} from '@/lib/leads'

function leadIdFor(shopId: string, placeId: string) {
  const safe = placeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
  return `LEAD-${shopId.slice(0, 8)}-${safe || Date.now()}`
}

export async function importLeadsFromCsvText(
  csvText: string,
  shopId: string,
  actorId: string
): Promise<{ ok: true; result: LeadImportResult & { errorReportCsv: string } } | { ok: false; error: string }> {
  const parsed = parseLeadCsv(csvText)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const existing = await db
    .select({ placeId: salesLeads.placeId })
    .from(salesLeads)
    .where(eq(salesLeads.shopId, shopId))

  const existingPlaceIds = new Set(existing.map(row => row.placeId))
  const planned = planLeadImport(parsed.rows, existingPlaceIds)
  const now = Date.now()
  const importedIds: string[] = []

  if (planned.toInsert.length) {
    await db.transaction(async tx => {
      for (const lead of planned.toInsert) {
        const id = leadIdFor(shopId, lead.placeId)
        await tx.insert(salesLeads).values({
          id,
          shopId,
          businessName: lead.businessName,
          phone: lead.phone,
          phoneDigits: lead.phoneDigits,
          address: lead.address,
          website: lead.website,
          rating: lead.rating,
          reviewCount: lead.reviewCount,
          placeId: lead.placeId,
          source: lead.source,
          campaign: lead.campaign || '',
          status: 'new',
          notes: null,
          attempts: 0,
          retryAfter: null,
          createdAt: now,
          lastContactedAt: null,
          updatedAt: now
        })
        importedIds.push(id)
      }
      await tx.insert(auditLog).values({
        actor: actorId,
        action: 'leads.import',
        entity: 'sales_leads',
        entityId: 'bulk',
        detail: `Imported ${importedIds.length} lead(s); skipped ${planned.result.duplicates} duplicate(s); ${planned.result.failed} failed validation`,
        createdAt: now
      })
    })
  }

  return {
    ok: true,
    result: {
      imported: importedIds.length,
      duplicates: planned.result.duplicates,
      failed: planned.result.failed,
      failures: planned.result.failures,
      importedIds,
      errorReportCsv: failuresToCsv(planned.result.failures)
    }
  }
}

export async function logLeadContact(input: {
  shopId: string
  leadId: string
  actorId: string
  outcome: string
  detail?: string
}) {
  await db.insert(contactLogs).values({
    shopId: input.shopId,
    leadId: input.leadId,
    actorId: input.actorId,
    outcome: input.outcome,
    detail: input.detail || '',
    direction: 'outbound',
    aiDisclosure: true,
    createdAt: Date.now()
  })
}

export async function getExistingPlaceIds(shopId: string, placeIds: string[]) {
  if (!placeIds.length) return new Set<string>()
  const rows = await db
    .select({ placeId: salesLeads.placeId })
    .from(salesLeads)
    .where(and(eq(salesLeads.shopId, shopId), inArray(salesLeads.placeId, placeIds)))
  return new Set(rows.map(r => r.placeId))
}
