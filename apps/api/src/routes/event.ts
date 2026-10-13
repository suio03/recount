import { getConnInfo } from '@hono/node-server/conninfo'
import { EventPayload } from '@recount/shared'
import { Hono } from 'hono'
import { isbot } from 'isbot'
import { clickhouse } from '../db/clickhouse'
import { parseAcquisition, parseDevice } from '../ingest/enrich'
import { resolveIdentity } from '../ingest/identity'
import { siteByDomain } from '../sites'

export const eventRoutes = new Hono()

/** Formats a Date as ClickHouse DateTime64(3) text in UTC. */
const chTime = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '')

eventRoutes.post('/api/event', async (c) => {
  // Always answer 202 so the tracker never retries and visitors can't probe configuration.
  const accepted = () => c.body(null, 202)

  let payload: EventPayload
  try {
    const parsed = EventPayload.safeParse(JSON.parse(await c.req.text()))
    if (!parsed.success) return c.json({ error: 'invalid payload' }, 400)
    payload = parsed.data
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const userAgent = c.req.header('user-agent') ?? ''
  if (!userAgent || isbot(userAgent)) return accepted()

  const site = await siteByDomain(payload.s)
  if (!site) return accepted()

  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    getConnInfo(c).remote.address ??
    ''
  const now = new Date()
  const url = new URL(payload.u)
  const { visitorId, sessionId } = await resolveIdentity({
    siteId: site.id,
    mode: payload.m,
    vid: payload.vid,
    sid: payload.sid,
    ip,
    userAgent,
    now,
  })
  const device = parseDevice(userAgent, payload.w)
  const acquisition = parseAcquisition(url, payload.r)

  await clickhouse.insert({
    table: 'events',
    format: 'JSONEachRow',
    values: [
      {
        site_id: site.id,
        timestamp: chTime(now),
        name: payload.n,
        identity_mode: payload.m,
        visitor_id: visitorId.toString(),
        session_id: sessionId.toString(),
        hostname: url.hostname,
        pathname: url.pathname,
        page_title: payload.t ?? '',
        page_type: payload.pt ?? '',
        referrer: acquisition.referrer,
        referrer_source: acquisition.referrerSource,
        channel: acquisition.channel,
        utm_source: acquisition.utmSource,
        utm_medium: acquisition.utmMedium,
        utm_campaign: acquisition.utmCampaign,
        utm_term: acquisition.utmTerm,
        utm_content: acquisition.utmContent,
        click_id_type: acquisition.clickIdType,
        // Cloudflare in front of the API supplies the country; city/region need a geo database (TODO).
        country_code: (c.req.header('cf-ipcountry') ?? '').replace(/^(XX|T1)$/, '').slice(0, 2),
        region: '',
        city: '',
        browser: device.browser,
        browser_version: device.browserVersion,
        os: device.os,
        os_version: device.osVersion,
        device: device.device,
        screen_width: payload.w ?? 0,
        language: payload.l ?? '',
        timezone: payload.tz ?? '',
        element_tag: payload.el?.tag ?? '',
        element_text: payload.el?.text ?? '',
        element_label: payload.el?.label ?? '',
        element_href: payload.el?.href ?? '',
        element_section: payload.el?.section ?? '',
        props: payload.p ?? {},
      },
    ],
  })

  return accepted()
})
