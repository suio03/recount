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
  /** Directory holding the built tracker, served at /js/script.js. */
  TRACKER_DIST: z
    .string()
    .default(new URL('../../../packages/tracker/dist', import.meta.url).pathname),
})

export const env = Env.parse(process.env)
