import { UAParser } from 'ua-parser-js'
import { classifyChannel } from './channel'

const CLICK_IDS = [
  'gclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'fbclid',
  'ttclid',
  'twclid',
  'li_fat_id',
]

export function parseDevice(userAgent: string, screenWidth: number | undefined) {
  const ua = UAParser(userAgent)
  // Prefer screen width: user agents misreport tablets and desktop-mode phones.
  let device =
    ua.device.type === 'mobile' ? 'Mobile' : ua.device.type === 'tablet' ? 'Tablet' : 'Desktop'
  if (screenWidth) device = screenWidth < 576 ? 'Mobile' : screenWidth < 992 ? 'Tablet' : 'Desktop'
  return {
    browser: ua.browser.name ?? '',
    browserVersion: ua.browser.major ?? '',
    os: ua.os.name ?? '',
    osVersion: ua.os.version ?? '',
    device,
  }
}

export function parseAcquisition(pageUrl: URL, referrer: string | undefined) {
  const q = pageUrl.searchParams
  let source = ''
  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, '')
      // Internal navigation is not a source.
      if (host !== pageUrl.hostname.replace(/^www\./, '')) source = host
    } catch {}
  }
  const utmSource = q.get('utm_source') ?? q.get('ref') ?? ''
  const utmMedium = q.get('utm_medium') ?? ''
  const clickIdType = CLICK_IDS.find((id) => q.has(id)) ?? ''
  const referrerSource = source || utmSource.toLowerCase()
  return {
    referrer: source ? (referrer ?? '') : '',
    referrerSource,
    channel: classifyChannel({ source: referrerSource, utmMedium, clickIdType }),
    utmSource,
    utmMedium,
    utmCampaign: q.get('utm_campaign') ?? '',
    utmTerm: q.get('utm_term') ?? '',
    utmContent: q.get('utm_content') ?? '',
    clickIdType,
  }
}
