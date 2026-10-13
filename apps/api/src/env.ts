import { z } from 'zod'

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  DATABASE_URL: z.string(),
  CLICKHOUSE_URL: z.url(),
  CLICKHOUSE_USER: z.string().default('default'),
  CLICKHOUSE_PASSWORD: z.string().default(''),
  CLICKHOUSE_DATABASE: z.string().default('recount'),
  /** Bearer token for the private API until real auth lands. */
  ADMIN_TOKEN: z.string().min(24),
  /** Enables the AI reading. Without it the dashboard still shows the detected changes. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  READING_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Writes one summary per notable recorded session, so a smaller model keeps the cost down. */
  REPLAY_MODEL: z.string().default('claude-haiku-5-5'),
  /** At most this many session summaries per site per day; the most notable sessions go first. */
  REPLAY_SUMMARIES_PER_DAY: z.coerce.number().int().min(0).default(50),
  /** Directory holding the built tracker, served at /js/script.js. */
  TRACKER_DIST: z
    .string()
    .default(new URL('../../../packages/tracker/dist', import.meta.url).pathname),
})

export const env = Env.parse(process.env)
