import type { FunnelStage, PropertyDefinition } from '@recount/semantic'
import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { Draft } from '../semantics/draft'
import type { GoalMatch, Match } from '../stats/goals'

// Tables are created by SQL files in migrations/postgres; keep these definitions in sync.

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export type Role = 'owner' | 'admin' | 'viewer'

/**
 * What an API key may do: act as an admin of its org, read data and define events as a coding
 * agent, or only send server-side events.
 */
export type KeyScope = 'admin' | 'agent' | 'ingest'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
)

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<Role>().notNull(),
  tokenHash: bytea('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userSessions = pgTable('user_sessions', {
  tokenHash: bytea('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: bytea('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  scope: text('scope').$type<KeyScope>().notNull().default('admin'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  currency: text('currency').notNull().default('USD'),
  /** Whether the model reads this site: the dashboard reading and replay summaries. */
  ai: boolean('ai').notNull().default(false),
  /** Opens the public read-only dashboard at /share/<token>; null when there is none. */
  shareToken: text('share_token').unique(),
  /** How often the model drafts the site's goals and funnels. */
  draftSchedule: text('draft_schedule').$type<DraftSchedule>().notNull().default('off'),
  /** Whether a draft's new goals and funnels are added on their own or wait for a person. */
  draftApply: text('draft_apply').$type<DraftApply>().notNull().default('review'),
  /** Which custom events mean activating and paying; null while they are guessed from names. */
  keyEvents: jsonb('key_events').$type<KeyEvents>(),
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
  /** The variable holding the key, for sources set up with the CLI. */
  keyEnv: text('key_env'),
  /** The key itself, sealed, for sources connected in the dashboard. */
  keyCipher: bytea('key_cipher'),
  keyHint: text('key_hint'),
  match: jsonb('match').$type<Record<string, string>>().notNull().default({}),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const replaySummaries = pgTable(
  'replay_summaries',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    reasons: text('reasons').array().notNull(),
    body: jsonb('body').notNull(),
    model: text('model').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.sessionId] })],
)

/** A goal defined by a rule: a page visit or a click. Custom events need no definition. */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    match: jsonb('match').$type<GoalMatch>().notNull(),
    /** Added from a draft rather than by a person. */
    drafted: boolean('drafted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.siteId, t.name)],
)

export interface FunnelStep {
  name: string
  match: Match
}

export const funnels = pgTable(
  'funnels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    steps: jsonb('steps').$type<FunnelStep[]>().notNull(),
    /** Added from a draft rather than by a person. */
    drafted: boolean('drafted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.siteId, t.name)],
)

/** One model call, with its tokens and cost in millionths of a US dollar. */
export const aiUsage = pgTable('ai_usage', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
  /** What the call was for: a reading, a session summary, a patterns digest or site semantics. */
  kind: text('kind').$type<AiKind>().notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A site's semantics as last drafted, or why no draft could be made. */
export const semanticDrafts = pgTable('semantic_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  rangeFrom: date('range_from').notNull(),
  rangeTo: date('range_to').notNull(),
  body: jsonb('body').$type<Draft>(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A goal or funnel name a person removed or turned down, lowercased; drafts never re-add it. */
export const semanticDismissals = pgTable(
  'semantic_dismissals',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'goal' | 'funnel'>().notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.kind, t.name] })],
)

/** What a custom event means, registered by a person or a coding agent. */
export const eventDefinitions = pgTable(
  'event_definitions',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    stage: text('stage').$type<FunnelStage>(),
    key: boolean('key').notNull().default(false),
    properties: jsonb('properties')
      .$type<Record<string, PropertyDefinition>>()
      .notNull()
      .default({}),
    definedBy: text('defined_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.name] })],
)

export type EventDefinitionRow = typeof eventDefinitions.$inferSelect

export type DraftSchedule = 'off' | 'daily' | 'weekly'
export type DraftApply = 'review' | 'auto'

/** Custom events by what they mean for the dashboard's activation and payment figures. */
export interface KeyEvents {
  activation: string[]
  start: string[]
  paid: string[]
  failed: string[]
  closed: string[]
}
export type AiKind = 'reading' | 'brief' | 'why' | 'question' | 'summary' | 'digest' | 'semantics'
export type Site = typeof sites.$inferSelect
export type User = typeof users.$inferSelect
export type RevenueSource = typeof revenueSources.$inferSelect
export type Goal = typeof goals.$inferSelect
export type Funnel = typeof funnels.$inferSelect

/** A host's icon as fetched from it; no body means it had none. */
export const icons = pgTable('icons', {
  host: text('host').primaryKey(),
  contentType: text('content_type'),
  body: bytea('body'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})
