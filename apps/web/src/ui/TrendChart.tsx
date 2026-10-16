import { type PointerEvent, useEffect, useRef, useState } from 'react'
import type { Interval } from '../api'

export interface TrendPoint {
  /** The bucket in the site's timezone: `YYYY-MM-DD`, or `YYYY-MM-DD hh:mm:ss`. */
  t: string
  value: number
  revenue?: number
}

export interface TrendChartProps {
  data: TrendPoint[]
  /** What one point spans; sets how its time is written. */
  interval?: Interval
  /** Name of the plotted metric, used in the tooltip and the accessible label. */
  metric: string
  format?: (value: number) => string
  /** Formats revenue in the tooltip; set when the data carries revenue. */
  formatRevenue?: (revenue: number) => string
  /** AI annotations pinned to a point; `n` matches the InsightNote number. */
  annotations?: Array<{ index: number; n: number }>
  /** A usual value, drawn as a dashed line across the chart. */
  usual?: number
  /** Points marked under the line, such as days on which somebody tried to pay. */
  markers?: number[]
  /** What a marker means, for the tooltip. */
  markerLabel?: (index: number) => string | undefined
  /** Makes points clickable: called with the point's index. */
  onPick?: (index: number) => void
  /** The point picked, kept highlighted. */
  picked?: number
  height?: number
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const utc = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' })

/** Axis and tooltip formats per interval. Buckets are local times, so they format as UTC. */
const FORMATS: Record<Interval, { tick: Intl.DateTimeFormat; tip: Intl.DateTimeFormat }> = {
  minute: {
    tick: utc({ hour: 'numeric', minute: '2-digit' }),
    tip: utc({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  },
  hour: {
    tick: utc({ hour: 'numeric' }),
    tip: utc({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }),
  },
  day: {
    tick: utc({ month: 'short', day: 'numeric' }),
    tip: utc({ weekday: 'short', month: 'short', day: 'numeric' }),
  },
  month: {
    tick: utc({ month: 'short', year: 'numeric' }),
    tip: utc({ month: 'long', year: 'numeric' }),
  },
}

const parse = (t: string) => new Date(t.length === 10 ? t : `${t.replace(' ', 'T')}Z`)

function niceMax(v: number) {
  const mag = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / mag / 2) * 2 * mag
}

/**
 * The metric as a line over a light area, revenue as solid bars drawn above the area (so the two
 * hues never blend), and AI pins on top. Drawn at the container's real width so text stays crisp.
 */
export function TrendChart({
  data,
  interval = 'day',
  metric,
  format = (v) => v.toLocaleString('en'),
  formatRevenue,
  annotations = [],
  usual,
  markers = [],
  markerLabel,
  onPick,
  picked,
  height = 240,
}: TrendChartProps) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number>()

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pad = { t: 24, r: 8, b: 24, l: 40 }
  const iw = Math.max(1, width - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const vMax = niceMax(Math.max(1, usual ?? 0, ...data.map((d) => d.value)))
  const rMax = Math.max(1, ...data.map((d) => d.revenue ?? 0)) * 1.6
  const step = iw / Math.max(1, data.length)
  const x = (i: number) => pad.l + step * i + step / 2
  const y = (v: number) => pad.t + ih - (v / vMax) * ih
  const line = data
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join('')
  const area = `${line}L${x(data.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 90))))
  const point = hover === undefined ? undefined : data[hover]

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left
    const i = Math.floor((e.clientX - left - pad.l) / step)
    setHover(i >= 0 && i < data.length ? i : undefined)
  }

  return (
    <div ref={box} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${metric} by ${interval}`}
        className={onPick ? 'block cursor-pointer' : 'block'}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(undefined)}
        onClick={() => hover !== undefined && onPick?.(hover)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              className="stroke-line"
              x1={pad.l}
              x2={width - pad.r}
              y1={y(f * vMax)}
              y2={y(f * vMax)}
            />
            <text
              className="fill-muted font-mono text-tick"
              x={pad.l - 8}
              y={y(f * vMax) + 4}
              textAnchor="end"
            >
              {compact.format(f * vMax)}
            </text>
          </g>
        ))}
        {picked !== undefined && data[picked] && (
          <rect
            className="fill-visitors-soft"
            x={x(picked) - step / 2}
            width={step}
            y={pad.t}
            height={ih}
          />
        )}
        <path className="fill-visitors opacity-[0.08]" d={area} />
        {data.map((d, i) =>
          d.revenue ? (
            <rect
              key={`r${d.t}`}
              className="fill-revenue"
              x={x(i) - step * 0.3}
              width={step * 0.6}
              y={pad.t + ih - (d.revenue / rMax) * ih}
              height={(d.revenue / rMax) * ih}
              rx={2}
            />
          ) : null,
        )}
        {usual !== undefined && (
          <g>
            <line
              className="stroke-line-strong"
              strokeDasharray="4 4"
              x1={pad.l}
              x2={width - pad.r}
              y1={y(usual)}
              y2={y(usual)}
            />
            <text
              className="fill-muted text-tick"
              x={width - pad.r}
              y={y(usual) - 5}
              textAnchor="end"
            >
              usual {compact.format(usual)}
            </text>
          </g>
        )}
        {point && (
          <line
            className="stroke-line-strong"
            x1={x(hover ?? 0)}
            x2={x(hover ?? 0)}
            y1={pad.t}
            y2={pad.t + ih}
          />
        )}
        <path
          className="fill-none stroke-visitors"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          d={line}
        />
        {point && (
          <circle
            className="fill-surface stroke-visitors"
            strokeWidth={2}
            r={4}
            cx={x(hover ?? 0)}
            cy={y(point.value)}
          />
        )}
        {markers.map((i) =>
          data[i] ? (
            <circle
              key={`m${i}`}
              className="fill-revenue stroke-surface"
              strokeWidth={2}
              r={4.5}
              cx={x(i)}
              cy={pad.t + ih}
            />
          ) : null,
        )}
        {data.map((d, i) =>
          i % every === 0 ? (
            <text
              key={`t${d.t}`}
              className="fill-muted font-mono text-tick"
              x={x(i)}
              y={height - 6}
              textAnchor="middle"
            >
              {FORMATS[interval].tick.format(parse(d.t))}
            </text>
          ) : null,
        )}
        {annotations.map((a) => {
          const d = data[a.index]
          if (!d) return null
          return (
            <g key={a.n}>
              <line
                className="stroke-ink"
                strokeDasharray="2 3"
                x1={x(a.index)}
                x2={x(a.index)}
                y1={14}
                y2={y(d.value)}
              />
              <circle className="fill-ink" cx={x(a.index)} cy={12} r={9} />
              <text
                className="fill-on-ink text-tick font-semibold"
                x={x(a.index)}
                y={16}
                textAnchor="middle"
              >
                {a.n}
              </text>
            </g>
          )
        })}
      </svg>
      {point && hover !== undefined && (
        <div
          className="pointer-events-none absolute top-1 z-10 grid gap-0.5 rounded-sm border border-line bg-surface px-3 py-2 shadow-pop"
          style={x(hover) > width / 2 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
        >
          <span className="text-label text-muted">
            {FORMATS[interval].tip.format(parse(point.t))}
          </span>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="size-2 rounded-full bg-visitors" aria-hidden="true" />
            {metric}
            <span className="ml-auto pl-3 font-medium tabular-nums">{format(point.value)}</span>
          </span>
          {markerLabel?.(hover) && (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="size-2 rounded-full bg-revenue" aria-hidden="true" />
              {markerLabel(hover)}
            </span>
          )}
          {formatRevenue && point.revenue !== undefined && (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="size-2 rounded-full bg-revenue" aria-hidden="true" />
              Revenue
              <span className="ml-auto pl-3 font-medium tabular-nums">
                {formatRevenue(point.revenue)}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
