import { bigint, boolean, index, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

export const records = pgTable('records', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  shopId: text('shop_id').notNull(),
  data: text('data').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
}, table => [index('records_kind_shop_idx').on(table.kind, table.shopId)])

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  detail: text('detail').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
})

export const authUsers = pgTable('auth_users', {
  id: text('id').primaryKey(),
  shopId: text('shop_id').notNull(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  lastSeenAt: bigint('last_seen_at', { mode: 'number' }).notNull()
}, table => [uniqueIndex('sessions_token_idx').on(table.tokenHash)])

export const estimateApprovalLinks = pgTable('estimate_approval_links', {
  id: text('id').primaryKey(),
  shopId: text('shop_id').notNull(),
  orderId: text('order_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull(),
  createdBy: text('created_by').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  respondedAt: bigint('responded_at', { mode: 'number' })
}, table => [
  uniqueIndex('estimate_approval_links_token_idx').on(table.tokenHash),
  index('estimate_approval_links_order_idx').on(table.shopId, table.orderId)
])
