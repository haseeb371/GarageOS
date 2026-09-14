import 'server-only'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required. Copy .env.example to .env.local and configure PostgreSQL.')

const globalForDb = globalThis as unknown as { garageSql?: ReturnType<typeof postgres>; garageSchema?: Promise<void> }
export const sql = globalForDb.garageSql ?? postgres(connectionString, {
  max: process.env.NODE_ENV === 'production' ? 10 : 3,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 15
})
if (process.env.NODE_ENV !== 'production') globalForDb.garageSql = sql

export const db = drizzle(sql, { schema })

export function ensureSchema() {
  globalForDb.garageSchema ??= sql.begin(async tx => {
    await tx`CREATE TABLE IF NOT EXISTS records (id text PRIMARY KEY, kind text NOT NULL, shop_id text NOT NULL, data text NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL)`
    await tx`CREATE INDEX IF NOT EXISTS records_kind_shop_idx ON records(kind, shop_id)`
    await tx`CREATE TABLE IF NOT EXISTS audit_log (id serial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity text NOT NULL, entity_id text NOT NULL, detail text NOT NULL, created_at bigint NOT NULL)`
    await tx`CREATE TABLE IF NOT EXISTS auth_users (id text PRIMARY KEY, shop_id text NOT NULL, email text NOT NULL UNIQUE, name text NOT NULL, role text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, created_at bigint NOT NULL, updated_at bigint NOT NULL)`
    await tx`CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text NOT NULL, token_hash text NOT NULL UNIQUE, expires_at bigint NOT NULL, created_at bigint NOT NULL, last_seen_at bigint NOT NULL)`
    await tx`CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token_hash)`
    await tx`CREATE TABLE IF NOT EXISTS estimate_approval_links (id text PRIMARY KEY, shop_id text NOT NULL, order_id text NOT NULL, token_hash text NOT NULL UNIQUE, status text NOT NULL, created_by text NOT NULL, expires_at bigint NOT NULL, created_at bigint NOT NULL, responded_at bigint)`
    await tx`CREATE INDEX IF NOT EXISTS estimate_approval_links_token_idx ON estimate_approval_links(token_hash)`
    await tx`CREATE INDEX IF NOT EXISTS estimate_approval_links_order_idx ON estimate_approval_links(shop_id, order_id)`
    await tx`CREATE TABLE IF NOT EXISTS customer_portal_links (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      order_id text NOT NULL,
      customer_id text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      created_by text NOT NULL,
      expires_at bigint NOT NULL,
      created_at bigint NOT NULL
    )`
    await tx`CREATE INDEX IF NOT EXISTS customer_portal_links_token_idx ON customer_portal_links(token_hash)`
    await tx`CREATE INDEX IF NOT EXISTS customer_portal_links_order_idx ON customer_portal_links(shop_id, order_id)`
    await tx`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`
    await tx`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false`
    await tx`CREATE TABLE IF NOT EXISTS auth_codes (id serial PRIMARY KEY, email text NOT NULL, code_hash text NOT NULL, purpose text NOT NULL, expires_at bigint NOT NULL, consumed_at bigint, created_at bigint NOT NULL)`
    await tx`CREATE INDEX IF NOT EXISTS auth_codes_email_idx ON auth_codes(email, purpose)`
    await tx`CREATE TABLE IF NOT EXISTS sales_leads (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      business_name text NOT NULL,
      phone text NOT NULL,
      phone_digits text NOT NULL,
      address text NOT NULL DEFAULT '',
      website text,
      rating double precision,
      review_count integer,
      place_id text NOT NULL,
      source text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'new',
      notes text,
      created_at bigint NOT NULL,
      last_contacted_at bigint,
      updated_at bigint NOT NULL
    )`
    await tx`CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_shop_place_idx ON sales_leads(shop_id, place_id)`
    await tx`CREATE INDEX IF NOT EXISTS sales_leads_shop_status_idx ON sales_leads(shop_id, status)`
    await tx`CREATE INDEX IF NOT EXISTS sales_leads_shop_source_idx ON sales_leads(shop_id, source)`
    await tx`CREATE TABLE IF NOT EXISTS contact_logs (
      id serial PRIMARY KEY,
      shop_id text NOT NULL,
      lead_id text NOT NULL,
      actor_id text NOT NULL,
      outcome text NOT NULL,
      detail text NOT NULL DEFAULT '',
      created_at bigint NOT NULL
    )`
    await tx`CREATE INDEX IF NOT EXISTS contact_logs_lead_idx ON contact_logs(shop_id, lead_id)`
    await tx`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS campaign text NOT NULL DEFAULT ''`
    await tx`CREATE INDEX IF NOT EXISTS sales_leads_shop_campaign_idx ON sales_leads(shop_id, campaign)`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS telnyx_call_id text`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'logged'`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS duration_seconds integer`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS updated_at bigint`
    await tx`CREATE INDEX IF NOT EXISTS contact_logs_telnyx_idx ON contact_logs(telnyx_call_id)`
    await tx`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`
    await tx`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS retry_after bigint`
    await tx`ALTER TABLE contact_logs ALTER COLUMN lead_id DROP NOT NULL`
    await tx`ALTER TABLE contact_logs ALTER COLUMN shop_id DROP NOT NULL`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outbound'`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS transcript jsonb DEFAULT '[]'::jsonb`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS recording_url text`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS ai_disclosure boolean NOT NULL DEFAULT false`
    await tx`ALTER TABLE contact_logs ADD COLUMN IF NOT EXISTS ended_at bigint`
    await tx`CREATE TABLE IF NOT EXISTS sales_campaigns (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      total_leads integer NOT NULL DEFAULT 0,
      dialed integer NOT NULL DEFAULT 0,
      interested integer NOT NULL DEFAULT 0,
      converted integer NOT NULL DEFAULT 0,
      created_at bigint NOT NULL,
      started_at bigint,
      ended_at bigint,
      updated_at bigint NOT NULL
    )`
    await tx`CREATE INDEX IF NOT EXISTS sales_campaigns_shop_idx ON sales_campaigns(shop_id, status)`
    await tx`CREATE TABLE IF NOT EXISTS dnc_phones (
      id serial PRIMARY KEY,
      shop_id text NOT NULL,
      phone_digits text NOT NULL,
      reason text NOT NULL DEFAULT '',
      created_at bigint NOT NULL
    )`
    await tx`CREATE UNIQUE INDEX IF NOT EXISTS dnc_phones_shop_digits_idx ON dnc_phones(shop_id, phone_digits)`
    await tx`CREATE TABLE IF NOT EXISTS notifications (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at bigint NOT NULL,
      read_at bigint
    )`
    await tx`CREATE INDEX IF NOT EXISTS notifications_shop_idx ON notifications(shop_id, created_at)`
    await tx`CREATE TABLE IF NOT EXISTS compliance_violations (
      id serial PRIMARY KEY,
      shop_id text NOT NULL,
      lead_id text,
      contact_log_id integer,
      reason text NOT NULL,
      detail text NOT NULL DEFAULT '',
      created_at bigint NOT NULL
    )`
    await tx`CREATE INDEX IF NOT EXISTS compliance_violations_shop_idx ON compliance_violations(shop_id)`
    await tx`CREATE TABLE IF NOT EXISTS demo_appointments (
      id text PRIMARY KEY,
      shop_id text NOT NULL,
      lead_id text,
      business_name text NOT NULL DEFAULT '',
      contact_name text NOT NULL DEFAULT '',
      phone text NOT NULL DEFAULT '',
      email text NOT NULL DEFAULT '',
      starts_at bigint NOT NULL,
      ends_at bigint NOT NULL,
      timezone text NOT NULL DEFAULT 'America/Chicago',
      status text NOT NULL DEFAULT 'scheduled',
      source text NOT NULL DEFAULT 'web',
      notes text NOT NULL DEFAULT '',
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL
    )`
    await tx`CREATE INDEX IF NOT EXISTS demo_appointments_shop_starts_idx ON demo_appointments(shop_id, starts_at)`
    await tx`CREATE INDEX IF NOT EXISTS demo_appointments_shop_status_idx ON demo_appointments(shop_id, status)`
  }).then(() => undefined).catch(error => { globalForDb.garageSchema = undefined; throw error })
  return globalForDb.garageSchema
}
