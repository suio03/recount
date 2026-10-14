const HOSTNAME = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/**
 * The hostname in what someone typed for a site, as the tracker reports it: `https://www.Example.com/
 * pricing` becomes `example.com`. Undefined when it is not a public hostname.
 */
export function normalizeDomain(input: string): string | undefined {
  let host = input.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split(/[/?#]/, 1)[0] ?? ''
  host = host
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '')
  return HOSTNAME.test(host) ? host : undefined
}

/** Whether ClickHouse and the browser both know the timezone. */
export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
