import { and, eq, inArray } from 'drizzle-orm'
import { db } from './db'
import { records } from './schema'
import { defaultRecordKinds, defaultShopRecords } from './shopDefaults'

export async function ensureShopDefaults(shopId: string, shopName: string) {
  const existing = await db.select({ kind: records.kind }).from(records).where(and(eq(records.shopId, shopId), inArray(records.kind, [...defaultRecordKinds])))
  const present = new Set(existing.map(row => row.kind))
  const missing = defaultRecordKinds.filter(kind => !present.has(kind))
  if (!missing.length) return 0
  const now = Date.now()
  const defaults = defaultShopRecords(shopId, shopName, now).filter(row => missing.includes(row.kind as typeof defaultRecordKinds[number]))
  if (!defaults.length) return 0
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
  return defaults.length
}
