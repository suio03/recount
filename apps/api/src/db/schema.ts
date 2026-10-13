import { customType, date, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Tables are created by SQL files in migrations/postgres; keep these definitions in sync.

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  currency: text('currency').notNull().default('USD'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const salts = pgTable('salts', {
  day: date('day').primaryKey(),
  salt: bytea('salt').notNull(),
})

export const readings = pgTable('readings', {
  key: text('key').primaryKey(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  body: jsonb('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const revenueSources = pgTable('revenue_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<'paddle' | 'stripe'>().notNull(),
  keyEnv: text('key_env').notNull(),
  match: jsonb('match').$type<Record<string, string>>().notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Site = typeof sites.$inferSelect
export type RevenueSource = typeof revenueSources.$inferSelect
