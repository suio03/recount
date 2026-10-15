import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { api, type Scope } from '../api'
import { cx } from '../ui/cx'
import { change, Delta } from '../ui/Delta'
import { Panel } from '../ui/Panel'
import { EventProperties } from './EventProperties'
import { propertyFilterValue } from './filters'
import { percent } from './format'

const KIND_HINTS = { page: 'Page', click: 'Click' } as const

/**
 * Custom events and defined goals with the share of visitors who reached them. The change compares that
 * conversion rate with the previous period, not the raw count. A custom event opens to the
 * properties it carries.
 */
export function GoalsPanel({
  scope,
  onFilter,
}: {
  scope: Scope
  onFilter: (key: 'goal' | 'prop', value: string) => void
}) {
  const [opened, setOpened] = useState<string>()
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
              const open = g.kind === 'event' && opened === g.name
              return (
                <Fragment key={g.name}>
                  <tr className="border-t border-line">
                    <th scope="row" className="py-2 text-left font-normal">
                      <span className="flex items-center gap-1">
                        {g.kind === 'event' ? (
                          <button
                            type="button"
                            onClick={() => setOpened(open ? undefined : g.name)}
                            aria-expanded={open}
                            aria-label={`${open ? 'Hide' : 'Show'} properties of ${g.name}`}
                            title={`${open ? 'Hide' : 'Show'} properties`}
                            className="-ml-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-ink"
                          >
                            <ChevronRight
                              className={cx('size-3.5 transition-transform', open && 'rotate-90')}
                              strokeWidth={1.75}
                            />
                          </button>
                        ) : (
                          <span className="-ml-1 size-5 shrink-0" />
                        )}
                        <button
                          type="button"
                          onClick={() => onFilter('goal', g.name)}
                          title={`Filter by goal: ${g.name}`}
                          className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
                        >
                          <span className={cx(g.kind === 'event' && 'font-mono text-path')}>
                            {g.name}
                          </span>
                          {g.kind !== 'event' && (
                            <span className="ml-2 text-label text-muted">{KIND_HINTS[g.kind]}</span>
                          )}
                        </button>
                      </span>
                    </th>
                    <td className="py-2 text-right font-medium">
                      {g.visitors.toLocaleString('en')}
                    </td>
                    <td className="py-2 text-right font-medium">{percent(rate, 1)}</td>
                    <td className="py-2 text-right">
                      {delta === undefined ? (
                        <span className="text-label text-muted">—</span>
                      ) : (
                        <Delta value={delta} />
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={4} className="pt-1 pb-4 pl-5">
                        <EventProperties
                          scope={scope}
                          event={g.name}
                          onFilter={(key, value) =>
                            onFilter('prop', propertyFilterValue(key, value))
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
