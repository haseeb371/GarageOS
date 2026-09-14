import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

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
  emailVerified: boolean('email_verified').notNull().default(false),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
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

/** Tokenized customer status + pay portal (sibling to estimate approval). */
export const customerPortalLinks = pgTable('customer_portal_links', {
  id: text('id').primaryKey(),
  shopId: text('shop_id').notNull(),
  orderId: text('order_id').notNull(),
  customerId: text('customer_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdBy: text('created_by').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
}, table => [
  uniqueIndex('customer_portal_links_token_idx').on(table.tokenHash),
  index('customer_portal_links_order_idx').on(table.shopId, table.orderId)
])

export const authCodes = pgTable('auth_codes', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  purpose: text('purpose').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  consumedAt: bigint('consumed_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
}, table => [
  index('auth_codes_email_idx').on(table.email, table.purpose)
])

export const salesLeads = pgTable(
  'sales_leads',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    businessName: text('business_name').notNull(),
    phone: text('phone').notNull(),
    phoneDigits: text('phone_digits').notNull(),
    address: text('address').notNull().default(''),
    website: text('website'),
    rating: doublePrecision('rating'),
    reviewCount: integer('review_count'),
    placeId: text('place_id').notNull(),
    source: text('source').notNull().default(''),
    campaign: text('campaign').notNull().default(''),
    status: text('status').notNull().default('new'),
    notes: text('notes'),
    attempts: integer('attempts').notNull().default(0),
    retryAfter: bigint('retry_after', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    lastContactedAt: bigint('last_contacted_at', { mode: 'number' }),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
  },
  table => [
    uniqueIndex('sales_leads_shop_place_idx').on(table.shopId, table.placeId),
    index('sales_leads_shop_status_idx').on(table.shopId, table.status),
    index('sales_leads_shop_source_idx').on(table.shopId, table.source),
    index('sales_leads_shop_campaign_idx').on(table.shopId, table.campaign)
  ]
)

export type TranscriptChunk = { role: string; text: string; at: number }

export const contactLogs = pgTable(
  'contact_logs',
  {
    id: serial('id').primaryKey(),
    shopId: text('shop_id'),
    leadId: text('lead_id'),
    actorId: text('actor_id').notNull(),
    outcome: text('outcome').notNull(),
    detail: text('detail').notNull().default(''),
    direction: text('direction').notNull().default('outbound'),
    telnyxCallId: text('telnyx_call_id'),
    status: text('status').notNull().default('logged'),
    transcript: jsonb('transcript').$type<TranscriptChunk[]>().default([]),
    recordingUrl: text('recording_url'),
    durationSeconds: integer('duration_seconds'),
    aiDisclosure: boolean('ai_disclosure').notNull().default(false),
    endedAt: bigint('ended_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' })
  },
  table => [
    index('contact_logs_lead_idx').on(table.shopId, table.leadId),
    index('contact_logs_telnyx_idx').on(table.telnyxCallId)
  ]
)

export const salesCampaigns = pgTable(
  'sales_campaigns',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'),
    totalLeads: integer('total_leads').notNull().default(0),
    dialed: integer('dialed').notNull().default(0),
    interested: integer('interested').notNull().default(0),
    converted: integer('converted').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    startedAt: bigint('started_at', { mode: 'number' }),
    endedAt: bigint('ended_at', { mode: 'number' }),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
  },
  table => [index('sales_campaigns_shop_idx').on(table.shopId, table.status)]
)

export const dncPhones = pgTable(
  'dnc_phones',
  {
    id: serial('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    phoneDigits: text('phone_digits').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  table => [uniqueIndex('dnc_phones_shop_digits_idx').on(table.shopId, table.phoneDigits)]
)

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    readAt: bigint('read_at', { mode: 'number' })
  },
  table => [index('notifications_shop_idx').on(table.shopId, table.createdAt)]
)

export const complianceViolations = pgTable(
  'compliance_violations',
  {
    id: serial('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    leadId: text('lead_id'),
    contactLogId: integer('contact_log_id'),
    reason: text('reason').notNull(),
    detail: text('detail').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  table => [index('compliance_violations_shop_idx').on(table.shopId)]
)
