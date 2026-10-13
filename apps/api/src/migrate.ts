import { readdir, readFile } from 'node:fs/promises'
import { clickhouse } from './db/clickhouse'
import { sql } from './db/postgres'

// Applies every not-yet-applied SQL file in migrations/{postgres,clickhouse}, in name order.

const root = new URL('../migrations/', import.meta.url)

async function files(dir: string) {
  const names = (await readdir(new URL(dir, root))).filter((f) => f.endsWith('.sql')).sort()
  return Promise.all(
    names.map(async (name) => ({
      name,
      body: await readFile(new URL(`${dir}/${name}`, root), 'utf8'),
    })),
  )
}

async function migratePostgres() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string),
  )
  for (const file of await files('postgres')) {
    if (applied.has(file.name)) continue
    await sql.begin(async (tx) => {
      await tx.unsafe(file.body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${file.name})`
    })
    console.log(`postgres: applied ${file.name}`)
  }
}

async function migrateClickhouse() {
  await clickhouse.command({
    query: `CREATE TABLE IF NOT EXISTS schema_migrations (name String, applied_at DateTime DEFAULT now())
            ENGINE = MergeTree ORDER BY name`,
  })
  const result = await clickhouse.query({
    query: 'SELECT name FROM schema_migrations',
    format: 'JSONEachRow',
  })
  const applied = new Set((await result.json<{ name: string }>()).map((r) => r.name))
  for (const file of await files('clickhouse')) {
    if (applied.has(file.name)) continue
    // ClickHouse runs one statement per request.
    for (const statement of file.body
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean)) {
      await clickhouse.command({ query: statement })
    }
    await clickhouse.insert({
      table: 'schema_migrations',
      values: [{ name: file.name }],
      format: 'JSONEachRow',
    })
    console.log(`clickhouse: applied ${file.name}`)
  }
}

await migratePostgres()
await migrateClickhouse()
await sql.end()
await clickhouse.close()
