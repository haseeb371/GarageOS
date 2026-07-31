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
  }).then(() => undefined).catch(error => { globalForDb.garageSchema = undefined; throw error })
  return globalForDb.garageSchema
}
