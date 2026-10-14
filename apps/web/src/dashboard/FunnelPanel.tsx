import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Scope } from '../api'
import { cx } from '../ui/cx'
import { change, Delta } from '../ui/Delta'
import { inputClass } from '../ui/Form'
import { Panel } from '../ui/Panel'
import { percent } from './format'

/**
 * A funnel's steps with the visitors who reached each in order within one visit. The change
 * compares the whole funnel's conversion with the previous period. Hidden until the site has a
 * funnel.
 */
export function FunnelPanel({ scope }: { scope: Scope }) {
  const list = useQuery({
    queryKey: ['funnels', scope.siteId, scope.share],
    queryFn: () => api.funnels(scope),
  })
  const [picked, setPicked] = useState<string>()
  const funnels = list.data?.funnels ?? []
  const id = funnels.find((f) => f.id === picked)?.id ?? funnels[0]?.id
  const funnel = useQuery({
    queryKey: ['funnel', scope, id],
    queryFn: () => api.funnel(scope, id as string),
    enabled: id !== undefined,
    placeholderData: (prev) => (prev?.id === id ? prev : undefined),
  })
  if (!id) return null

  const steps = funnel.data?.steps ?? []
  const first = steps[0]?.visitors ?? 0
  const last = steps.at(-1)
  const rate = first && last ? last.visitors / first : 0
  const before = steps[0]?.previous_visitors ?? 0
  const delta = before && last ? change(rate, last.previous_visitors / before) : undefined

  return (
    <Panel
      title="Funnel"
      actions={
        funnels.length > 1 ? (
          <select
            aria-label="Funnel"
            className={cx(inputClass, 'h-7 max-w-48 text-label')}
            value={id}
            onChange={(e) => setPicked(e.target.value)}
          >
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate text-label text-muted">{funnels[0]?.name}</span>
        )
      }
    >
      {funnel.isError ? (
        <p className="text-muted">Could not load: {String(funnel.error)}</p>
      ) : !funnel.data ? (
        <div className="h-40 animate-pulse rounded-xs bg-sunken/40" />
      ) : (
        <>
          <ol className="m-0 grid list-none gap-0.5 p-0 tabular-nums">
            {steps.map((step, i) => {
              const previous = i > 0 ? (steps[i - 1]?.visitors ?? 0) : 0
              const dropped = previous - step.visitors
              return (
                <li key={`${i}-${step.name}`} className="grid gap-0.5">
                  {i > 0 && (
                    <span className="pl-7 text-label text-muted">
                      {dropped > 0
                        ? `${dropped.toLocaleString('en')} left (${percent(dropped / previous, 0)})`
                        : 'None left'}
                    </span>
                  )}
                  <div className="relative flex items-center gap-2 px-2 py-1.5">
                    <span
                      className="absolute inset-y-px left-0 rounded-xs bg-visitors-soft"
                      style={{ width: `${first ? (step.visitors / first) * 100 : 0}%` }}
                    />
                    <span className="relative w-5 shrink-0 text-label text-muted">{i + 1}</span>
                    <span
                      className={cx(
                        'relative min-w-0 flex-1 truncate',
                        (step.kind === 'event' || step.name.startsWith('/')) &&
                          'font-mono text-path',
                      )}
                      title={step.name}
                    >
                      {step.name}
                    </span>
                    <span className="relative w-16 text-right font-medium">
                      {step.visitors.toLocaleString('en')}
                    </span>
                    <span className="relative w-14 text-right text-muted">
                      {i === 0 ? '' : first ? percent(step.visitors / first, 1) : '—'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
          <p className="m-0 flex items-center justify-between gap-2 border-line border-t pt-2 text-label text-muted">
            <span>
              Converted <span className="font-semibold text-ink">{percent(rate, 1)}</span> of
              visitors who started
            </span>
            {delta !== undefined && <Delta value={delta} />}
          </p>
        </>
      )}
    </Panel>
  )
}
