import { createClient } from '@clickhouse/client'
import { env } from '../env'

export const clickhouse = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  // Let ClickHouse batch small inserts server-side instead of buffering in the API process.
  // Return 64-bit counts as JSON numbers rather than strings.
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 1,
    output_format_json_quote_64bit_integers: 0,
  },
})
