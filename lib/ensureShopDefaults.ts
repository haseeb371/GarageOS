import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { records } from './schema'
import { defaultSalesCallAgent } from './calling'
import { defaultRecordKinds, defaultShopRecords } from './shopDefaults'

export async function ensureShopDefaults(shopId: string, shopName: string) {
  const existing = await db.select({ kind: records.kind }).from(records).where(and(eq(records.shopId, shopId), inArray(records.kind, [...defaultRecordKinds])))
  const present = new Set(existing.map(row => row.kind))
  const missing = defaultRecordKinds.filter(kind => !present.has(kind))
  const now = Date.now()
  if (missing.length) {
    const defaults = defaultShopRecords(shopId, shopName, now).filter(row => missing.includes(row.kind as typeof defaultRecordKinds[number]))
    if (defaults.length) {
      await db.transaction(async tx => {
        for (const row of defaults) {
          await tx.insert(records).values({
            id: row.id,
            kind: row.kind,
            shopId,
            data: JSON.stringify(row.data),
            createdAt: now,
            updatedAt: now
          }).onConflictDoNothing()
        }
      })
    }
  }

  // Always upsert the trained AutoGaragify sales agent scripts.
  await ensureTrainedSalesAgent(shopId)
  return missing.length
}

/** Refresh/activate the product sales voice agent for this shop. */
export async function ensureTrainedSalesAgent(shopId: string) {
  const agent = defaultSalesCallAgent(shopId)
  const now = Date.now()
  await db
    .insert(records)
    .values({
      id: agent.id,
      kind: 'callAgents',
      shopId,
      data: JSON.stringify({ ...agent, shopId }),
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: records.id,
      set: {
        data: JSON.stringify({ ...agent, shopId }),
        updatedAt: now
      }
    })
  return agent
}
