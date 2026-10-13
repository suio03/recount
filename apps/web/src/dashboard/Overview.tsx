import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type MainStats, type Scope } from '../api'
import { change } from '../ui/Delta'
import { KpiTile } from '../ui/KpiTile'
import { TrendChart } from '../ui/TrendChart'
import { compact, duration, percent } from './format'

type Series = 'visitors' | 'pageviews'

/** KPI strip plus the daily chart. Visitors and Pageviews tiles pick the charted series. */
export function Overview({ scope }: { scope: Scope }) {
  const [series, setSeries] = useState<Series>('visitors')
  const main = useQuery({
    queryKey: ['main', scope],
    queryFn: () => api.main(scope),
    placeholderData: (prev) => prev,
  })

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-line bg-surface">
      {main.isError ? (
        <p className="p-4 text-muted">Could not load stats: {String(main.error)}</p>
      ) : !main.data ? (
        <div className="h-[340px] animate-pulse bg-sunken/40" />
      ) : (
        <Body stats={main.data} series={series} onSeries={setSeries} />
      )}
    </section>
  )
}

function Body({
  stats,
  series,
  onSeries,
}: {
  stats: MainStats
  series: Series
  onSeries: (s: Series) => void
}) {
  const { totals: t, previous: p } = stats
  return (
    <>
      <div className="flex flex-wrap border-b border-line">
        <KpiTile
          label="Visitors"
          value={compact(t.visitors)}
          delta={change(t.visitors, p.visitors)}
          selected={series === 'visitors'}
          onSelect={() => onSeries('visitors')}
        />
        <KpiTile
          label="Pageviews"
          value={compact(t.pageviews)}
          delta={change(t.pageviews, p.pageviews)}
          selected={series === 'pageviews'}
          onSelect={() => onSeries('pageviews')}
        />
        <KpiTile
          label="Bounce rate"
          value={percent(t.bounce_rate)}
          delta={change(t.bounce_rate, p.bounce_rate)}
          higherIsBetter={false}
        />
        <KpiTile
          label="Session time"
          value={duration(t.avg_session_seconds)}
          delta={change(t.avg_session_seconds, p.avg_session_seconds)}
        />
      </div>
      <div className="px-4 pt-4 pb-2">
        <TrendChart
          metric={series === 'visitors' ? 'Visitors' : 'Pageviews'}
          data={stats.series.map((d) => ({ day: d.day, value: d[series] }))}
        />
      </div>
    </>
  )
}
