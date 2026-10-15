import { cx } from './cx'
import { HostIcon } from './HostIcon'

export interface BreakdownRow {
  key: string
  label: string
  /** Set for paths, hosts and event names, which are shown exactly as recorded. */
  mono?: boolean
  hint?: string
  /** A host whose icon leads the label, and the public link's token to ask for it with. */
  icon?: { host: string; share?: string }
  /** A flag emoji leading the label, for countries. */
  flag?: string
  visitors: number
  revenue?: number
}

export interface BreakdownListProps {
  dimension: string
  rows: BreakdownRow[]
  /** Formats a row's revenue; the revenue column shows only when this is set. */
  formatRevenue?: (revenue: number) => string
  /** Makes each row a filter: called with the row clicked. */
  onSelect?: (row: BreakdownRow) => void
}

/** Ranked rows with a fill showing each row's share of the top row, datafa.st style. */
export function BreakdownList({ dimension, rows, formatRevenue, onSelect }: BreakdownListProps) {
  const max = Math.max(1, ...rows.map((r) => r.visitors))
  return (
    <table className="w-full table-fixed border-separate border-spacing-y-0.5 tabular-nums">
      <thead>
        <tr className="text-label font-medium text-muted">
          <th scope="col" className="px-2 pb-1 text-left font-medium">
            {dimension}
          </th>
          <th scope="col" className="w-20 px-2 pb-1 text-right font-medium">
            Visitors
          </th>
          {formatRevenue && (
            <th scope="col" className="w-20 px-2 pb-1 text-right font-medium">
              Revenue
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="group">
            <th
              scope="row"
              className="relative px-2 py-1.5 text-left font-normal group-hover:bg-sunken"
            >
              <span
                className="absolute inset-y-px left-0 rounded-xs bg-visitors-soft"
                style={{ width: `${(r.visitors / max) * 100}%` }}
              />
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(r)}
                  title={`Filter by ${dimension.toLowerCase()}: ${r.label}`}
                  className="relative w-full cursor-pointer truncate text-left"
                >
                  <Label row={r} />
                </button>
              ) : (
                <span className="relative block truncate" title={r.label}>
                  <Label row={r} />
                </span>
              )}
            </th>
            <td className="px-2 py-1.5 text-right font-medium group-hover:bg-sunken">
              {r.visitors.toLocaleString('en')}
            </td>
            {formatRevenue && (
              <td className="px-2 py-1.5 text-right font-medium group-hover:bg-sunken">
                {r.revenue ? formatRevenue(r.revenue) : '—'}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Label({ row }: { row: BreakdownRow }) {
  return (
    <>
      {row.icon && (
        <HostIcon
          host={row.icon.host}
          share={row.icon.share}
          className="mr-2 inline-block size-4 align-[-3px]"
        />
      )}
      {row.flag && (
        <span
          aria-hidden="true"
          className="mr-2 inline-block w-4 text-center font-[Twemoji_Country_Flags,var(--font-sans)]"
        >
          {row.flag}
        </span>
      )}
      <span className={cx(row.mono && 'font-mono text-path')}>{row.label}</span>
      {row.hint && <span className="ml-2 text-label text-muted">{row.hint}</span>}
    </>
  )
}
