import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import * as schema from './schema'

// Notices are informational, like "already exists, skipping" on every migrate run.
export const sql = postgres(env.DATABASE_URL, { onnotice: () => {} })
export const db = drizzle(sql, { schema })
