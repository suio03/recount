import { useState } from 'react'
import { iconUrl } from '../api'
import { cx } from './cx'

/**
 * A site's or referrer's icon, as the server stored it. Hosts without one, and names that are
 * not hosts (a utm_source such as "newsletter"), get their first letter instead.
 */
export function HostIcon({
  host,
  share,
  className = 'size-4',
}: {
  host: string
  /** A public link's token, for viewers who are not signed in. */
  share?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const isHost = host.includes('.') && !/\s/.test(host)
  if (failed || !isHost)
    return (
      <span
        aria-hidden="true"
        className={cx(
          'inline-grid shrink-0 place-items-center rounded-xs bg-sunken text-[10px] font-semibold uppercase text-muted',
          className,
        )}
      >
        {host.replace(/^www\./, '').charAt(0)}
      </span>
    )
  return (
    <img
      src={iconUrl(host, share)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cx('shrink-0 rounded-xs object-contain', className)}
    />
  )
}
