import { useQuery } from '@tanstack/react-query'
import { api, type Scope } from '../api'
import { cx } from '../ui/cx'
import { change, Delta } from '../ui/Delta'
import { Panel } from '../ui/Panel'
import { percent } from './format'

const KIND_HINTS = { page: 'Page', click: 'Click' } as const

/**
 * Custom events and defined goals with the share of visitors who reached them. The change compares that
 * conversion rate with the previous period, not the raw count.
 */
export function GoalsPanel({
  scope,
  onFilter,
}: {
  scope: Scope
  onFilter: (goal: string) => void
}) {
  const goals = useQuery({
    queryKey: ['goals', scope],
    queryFn: () => api.goals(scope),
    placeholderData: (prev) => prev,
  })
  const main = useQuery({
    queryKey: ['main', scope],
    queryFn: () => api.main(scope),
    placeholderData: (prev) => prev,
  })

  return (
    <Panel
      title="Goals"
      actions={
        <span className="text-label text-muted">
          {Object.keys(scope.filters).length
            ? 'Share of filtered visitors'
            : 'Share of all visitors'}
        </span>
      }
    >
      {goals.isError ? (
        <p className="text-muted">Could not load: {String(goals.error)}</p>
      ) : !goals.data || !main.data ? (
        <div className="h-40 animate-pulse rounded-xs bg-sunken/40" />
      ) : goals.data.goals.length === 0 ? (
        <p className="py-6 text-center text-muted">No custom events or goals in this range.</p>
      ) : (
        <table className="w-full table-fixed tabular-nums">
          <thead>
            <tr className="text-label text-muted">
              <th scope="col" className="pb-1 text-left font-medium">
                Goal
              </th>
              <th scope="col" className="w-20 pb-1 text-right font-medium">
                Visitors
              </th>
              <th scope="col" className="w-16 pb-1 text-right font-medium">
                Rate
              </th>
              <th scope="col" className="w-16 pb-1 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {goals.data.goals.map((g) => {
              const total = main.data.totals.visitors
              const before = main.data.previous.visitors
              const rate = total ? g.visitors / total : 0
              const delta = before ? change(rate, g.previous_visitors / before) : undefined
              return (
                <tr key={g.name} className="border-t border-line">
                  <th scope="row" className="py-2 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => onFilter(g.name)}
                      title={`Filter by goal: ${g.name}`}
                      className="w-full cursor-pointer truncate text-left hover:underline"
                    >
                      <span className={cx(g.kind === 'event' && 'font-mono text-path')}>
                        {g.name}
                      </span>
                      {g.kind !== 'event' && (
                        <span className="ml-2 text-label text-muted">{KIND_HINTS[g.kind]}</span>
                      )}
                    </button>
                  </th>
                  <td className="py-2 text-right font-medium">{g.visitors.toLocaleString('en')}</td>
                  <td className="py-2 text-right font-medium">{percent(rate, 1)}</td>
                  <td className="py-2 text-right">
                    {delta === undefined ? (
                      <span className="text-label text-muted">—</span>
                    ) : (
                      <Delta value={delta} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
