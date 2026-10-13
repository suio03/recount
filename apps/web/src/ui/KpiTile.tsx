import { cx } from './cx'
import { Delta } from './Delta'

export interface KpiTileProps {
  label: string
  value: string
  delta?: number
  higherIsBetter?: boolean
  /** The chart series this tile names, shown as a colored dot. */
  swatch?: 'visitors' | 'revenue'
  /** Set when the tile drives the chart; the tile then works as a toggle. */
  selected?: boolean
  onSelect?: () => void
}

/** One headline metric. Selectable tiles double as the chart's series switch. */
export function KpiTile({
  label,
  value,
  delta,
  higherIsBetter,
  swatch,
  selected,
  onSelect,
}: KpiTileProps) {
  const body = (
    <>
      <span className="inline-flex items-center gap-1 text-label font-medium tracking-[0.01em] text-muted">
        {swatch && (
          <span
            className={cx(
              'size-2 rounded-full',
              swatch === 'visitors' ? 'bg-visitors' : 'bg-revenue',
            )}
            aria-hidden="true"
          />
        )}
        {label}
      </span>
      <span className="text-kpi font-semibold tabular-nums">{value}</span>
      {delta === undefined ? (
        <span className="text-label text-muted">no prior data</span>
      ) : (
        <Delta value={delta} higherIsBetter={higherIsBetter} />
      )}
    </>
  )
  const base = 'grid min-w-36 flex-1 gap-1 border-b-2 border-transparent px-4 py-3 text-left'
  if (!onSelect) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(base, 'cursor-pointer hover:bg-sunken', selected && 'border-b-visitors')}
    >
      {body}
    </button>
  )
}
