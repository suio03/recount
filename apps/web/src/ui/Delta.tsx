import { cx } from './cx'

export interface DeltaProps {
  /** Relative change as a fraction: 0.12 is +12%. */
  value: number
  /** False for metrics where a rise is bad, such as bounce rate. */
  higherIsBetter?: boolean
}

/** Change against the previous period: arrow, sign and percent, colored by whether it is good. */
export function Delta({ value, higherIsBetter = true }: DeltaProps) {
  const pct = Math.round(Math.abs(value) * 100)
  if (pct === 0) return <span className="text-label font-semibold text-muted">±0%</span>
  const rising = value > 0
  return (
    <span
      className={cx(
        'inline-flex items-baseline gap-0.5 text-label font-semibold tabular-nums',
        rising === higherIsBetter ? 'text-up' : 'text-down',
      )}
    >
      <span aria-hidden="true" className="mr-0.5 text-[9px]">
        {rising ? '▲' : '▼'}
      </span>
      {rising ? '+' : '−'}
      {pct}%
    </span>
  )
}

/** Relative change from `before` to `now`, or undefined when there is nothing to compare with. */
export function change(now: number, before: number): number | undefined {
  return before > 0 ? (now - before) / before : undefined
}
