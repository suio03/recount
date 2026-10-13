import { customType, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Tables are created by SQL files in migrations/postgres; keep these definitions in sync.

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const salts = pgTable('salts', {
  day: date('day').primaryKey(),
  salt: bytea('salt').notNull(),
})

export type Site = typeof sites.$inferSelect
