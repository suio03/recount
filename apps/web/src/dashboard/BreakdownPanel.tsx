import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Breakdown, type Dimension, type Scope } from '../api'
import { BreakdownList, type BreakdownRow } from '../ui/BreakdownList'
import { Panel } from '../ui/Panel'
import { SegmentedControl } from '../ui/SegmentedControl'
import { MONO_FILTERS } from './filters'
import { countryName, money } from './format'

export interface DimensionOption {
  value: Dimension
  /** Tab label. */
  label: string
  /** Column header for the dimension. */
  column: string
}

function toRow(
  dimension: Dimension,
  { value, visitors, revenue }: Breakdown['rows'][number],
): BreakdownRow {
  if (dimension === 'country')
    return { key: value, label: countryName(value), hint: value, visitors, revenue }
  return { key: value, label: value, mono: MONO_FILTERS.has(dimension), visitors, revenue }
}

/** A revenue formatter when any row earned something, so sites without payments show no column. */
function revenueFormat({ rows, currency }: Breakdown) {
  if (!rows.some((r) => r.revenue)) return undefined
  return (revenue: number) => money(revenue, currency)
}

/** One panel of ranked rows, optionally with tabs that switch the dimension. */
export function BreakdownPanel({
  title,
  options,
  scope,
  onFilter,
}: {
  title: string
  options: readonly [DimensionOption, ...DimensionOption[]]
  scope: Scope
  onFilter: (dimension: Dimension, value: string) => void
}) {
  const [dimension, setDimension] = useState<Dimension>(options[0].value)
  const current = options.find((o) => o.value === dimension) ?? options[0]
  const data = useQuery({
    queryKey: ['breakdown', scope, dimension],
    queryFn: () => api.breakdown(scope, dimension),
    placeholderData: (prev) => prev,
  })

  return (
    <Panel
      title={title}
      actions={
        options.length > 1 && (
          <SegmentedControl
            label={`${title} dimension`}
            options={options}
            value={dimension}
            onChange={setDimension}
          />
        )
      }
    >
      {data.isError ? (
        <p className="text-muted">Could not load: {String(data.error)}</p>
      ) : !data.data ? (
        <div className="h-48 animate-pulse rounded-xs bg-sunken/40" />
      ) : data.data.rows.length === 0 ? (
        <p className="py-6 text-center text-muted">
          No {current.column.toLowerCase()} data in this range.
        </p>
      ) : (
        <BreakdownList
          dimension={current.column}
          rows={data.data.rows.map((r) => toRow(dimension, r))}
          formatRevenue={revenueFormat(data.data)}
          onSelect={(row) => onFilter(dimension, row.key)}
        />
      )}
    </Panel>
  )
}
