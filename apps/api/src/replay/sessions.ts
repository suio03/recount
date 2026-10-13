import { clickhouse } from '../db/clickhouse'
import { rows } from '../stats/queries'
import { EXTRACT_VERSION, extract, type RrwebEvent } from './extract'

/** A session is over once nothing arrived for this long (the tracker's session length). */
const ENDED_AFTER_MINUTES = 30
/** Sessions are looked for this far back, which bounds the work after downtime. */
const LOOKBACK_DAYS = 3

const chTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '')

interface Chunk {
  load_id: string
  seq: number
  visitor_id: string
  data: string
}

/** A session's stored recording: its page loads, each an ordered list of rrweb events. */
export async function recordingOf(siteId: string, sessionId: string) {
  const chunks = await rows<Chunk>(
    `SELECT load_id, seq, toString(visitor_id) AS visitor_id, data
     FROM replay_chunks FINAL
     WHERE site_id = {site:UUID} AND session_id = {session:UInt64}
     ORDER BY load_id, seq`,
    { site: siteId, session: sessionId },
  )
  if (!chunks.length) return undefined
  const loads = new Map<string, RrwebEvent[]>()
  for (const c of chunks) {
    const events = loads.get(c.load_id) ?? []
    events.push(...(JSON.parse(c.data) as RrwebEvent[]))
    loads.set(c.load_id, events)
  }
  return { visitorId: chunks[0]?.visitor_id, loads: [...loads.values()] }
}

/**
 * The events a player needs, in time order. Loads whose snapshot was lost are left out, as
 * extraction leaves them out, so a moment's offset lands on the same instant in the replay.
 */
export function playable(loads: RrwebEvent[][]) {
  return loads
    .filter((l) => l.some((e) => e.type === 2))
    .flat()
    .sort((a, b) => a.timestamp - b.timestamp)
}

/** Extracts one session's timeline from its stored chunks and saves it. */
export async function extractSession(siteId: string, sessionId: string) {
  const recording = await recordingOf(siteId, sessionId)
  if (!recording) return undefined
  const loads = recording.loads
  const result = extract(loads)
  if (!result) return undefined
  await clickhouse.insert({
    table: 'replay_sessions',
    format: 'JSONEachRow',
    values: [
      {
        site_id: siteId,
        session_id: sessionId,
        visitor_id: recording.visitorId,
        started_at: chTime(result.startedAt),
        ended_at: chTime(result.endedAt),
        ...result.counts,
        timeline: JSON.stringify(result.timeline),
        version: EXTRACT_VERSION,
      },
    ],
  })
  return result
}

/**
 * Sessions whose recording ended and whose timeline is missing, older than the chunks, or from
 * an earlier version of the rules.
 */
export async function endedSessions(siteId?: string) {
  return rows<{ site_id: string; session_id: string }>(
    `SELECT c.site_id AS site_id, toString(c.session_id) AS session_id
     FROM (
       SELECT site_id, session_id, max(received_at) AS last
       FROM replay_chunks
       WHERE received_at > now64(3) - INTERVAL ${LOOKBACK_DAYS} DAY
         ${siteId ? 'AND site_id = {site:UUID}' : ''}
       GROUP BY site_id, session_id
       HAVING last < now64(3) - INTERVAL ${ENDED_AFTER_MINUTES} MINUTE
     ) AS c
     LEFT JOIN (
       SELECT site_id, session_id, max(extracted_at) AS extracted_at, max(version) AS version
       FROM replay_sessions
       WHERE started_at > now64(3) - INTERVAL ${LOOKBACK_DAYS + 1} DAY
       GROUP BY site_id, session_id
     ) AS s ON s.site_id = c.site_id AND s.session_id = c.session_id
     WHERE s.extracted_at < c.last OR s.version < {version:UInt16}`,
    { ...(siteId && { site: siteId }), version: EXTRACT_VERSION },
  )
}

/** Extracts every ended session; one bad recording does not stop the rest. */
export async function extractEnded(siteId?: string) {
  let done = 0
  for (const s of await endedSessions(siteId)) {
    try {
      if (await extractSession(s.site_id, s.session_id)) done++
    } catch (e) {
      console.error(`replay extract ${s.site_id}/${s.session_id}:`, e)
    }
  }
  return done
}
