import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type EventProperty, type Scope } from '../api'
import { BreakdownList } from '../ui/BreakdownList'
import { SegmentedControl } from '../ui/SegmentedControl'
import { percent } from './format'

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const num = (n: number) => number.format(n)

/**
 * The properties one custom event carries: pick a property to see its values with the visitors
 * carrying each, or, when every value is a number, its distribution first. A value filters the
 * dashboard to sessions with an event carrying it.
 */
export function EventProperties({
  scope,
  event,
  onFilter,
}: {
  scope: Scope
  event: string
  /** Called with the property's key and the value clicked. */
  onFilter: (key: string, value: string) => void
}) {
  const properties = useQuery({
    queryKey: ['properties', scope, event],
    queryFn: () => api.properties(scope, event),
    placeholderData: (prev) => (prev?.event === event ? prev : undefined),
  })
  const [picked, setPicked] = useState<string>()
  const keys = properties.data?.properties ?? []
  const key = keys.find((k) => k.key === picked)?.key ?? keys[0]?.key

  if (properties.isError)
    return <p className="text-muted">Could not load: {String(properties.error)}</p>
  if (!properties.data) return <div className="h-24 animate-pulse rounded-xs bg-sunken/40" />
  if (!key)
    return (
      <p className="text-label text-muted">
        No properties on this event in this range. Send them with{' '}
        <code className="font-mono text-path">
          recount('{event}', {'{'} props: {'{'} plan: 'pro' {'}'} {'}'})
        </code>
        .
      </p>
    )
  return (
    <div className="grid gap-3">
      <div>
        <SegmentedControl
          label={`Properties of ${event}`}
          options={keys.map((k) => ({ value: k.key, label: k.key }))}
          value={key}
          onChange={setPicked}
        />
      </div>
      <Property
        scope={scope}
        event={event}
        propertyKey={key}
        total={properties.data.events}
        onFilter={onFilter}
      />
    </div>
  )
}

function Property({
  scope,
  event,
  propertyKey,
  total,
  onFilter,
}: {
  scope: Scope
  event: string
  propertyKey: string
  /** All events of this name, to say how many carry the property. */
  total: number
  onFilter: (key: string, value: string) => void
}) {
  const property = useQuery({
    queryKey: ['property', scope, event, propertyKey],
    queryFn: () => api.property(scope, event, propertyKey),
  })
  if (property.isError)
    return <p className="text-muted">Could not load: {String(property.error)}</p>
  if (!property.data) return <div className="h-40 animate-pulse rounded-xs bg-sunken/40" />
  const p = property.data
  // The filter splits at the first `=`, so a key holding one cannot be filtered on.
  const filterable = !propertyKey.includes('=')
  return (
    <div className="grid gap-3">
      <p className="m-0 text-label text-muted">
        On {p.events.toLocaleString('en')} of {total.toLocaleString('en')} events (
        {percent(total ? p.events / total : 0)}), {p.distinct.toLocaleString('en')}{' '}
        {p.distinct === 1 ? 'value' : 'values'}
      </p>
      {p.distribution && <Distribution distribution={p.distribution} />}
      <BreakdownList
        dimension={p.distribution ? 'Top values' : 'Value'}
        rows={p.values.map((v) => ({
          key: v.value,
          label: v.value || '(empty)',
          mono: true,
          hint: `${v.events.toLocaleString('en')} events`,
          visitors: v.visitors,
        }))}
        onSelect={filterable ? (row) => onFilter(propertyKey, row.key) : undefined}
      />
    </div>
  )
}

/** Median and quartiles, then the events per equal-width bin, with a readout of the bin hovered. */
function Distribution({
  distribution: d,
}: {
  distribution: NonNullable<EventProperty['distribution']>
}) {
  const [hovered, setHovered] = useState<number>()
  const max = Math.max(1, ...d.bins.map((b) => b.events))
  const events = d.bins.reduce((s, b) => s + b.events, 0)
  // Bins one whole number wide stand for that number; wider ones for a span.
  const single = d.bins.every((b) => b.to - b.from === 1 && Number.isInteger(b.from))
  const label = (b: { from: number; to: number }) =>
    single ? num(b.from) : `${num(b.from)}–${num(b.to)}`
  const bin = hovered === undefined ? undefined : d.bins[hovered]
  return (
    <div className="grid gap-2">
      <dl className="m-0 grid grid-cols-3 gap-3 tabular-nums">
        <Stat term="Median" value={num(d.median)} />
        <Stat term="Middle half" value={`${num(d.p25)}–${num(d.p75)}`} />
        <Stat term="Range" value={`${num(d.min)}–${num(d.max)}`} />
      </dl>
      <p className="m-0 h-4 text-label text-muted tabular-nums" aria-live="polite">
        {bin
          ? `${label(bin)}: ${bin.events.toLocaleString('en')} events (${percent(events ? bin.events / events : 0)})`
          : 'Events by value'}
      </p>
      <div
        className="flex h-24 items-end gap-0.5 border-b border-line"
        role="img"
        aria-label={`Events by value: ${d.bins.map((b) => `${label(b)} ${b.events}`).join(', ')}`}
        onMouseLeave={() => setHovered(undefined)}
      >
        {d.bins.map((b, i) => (
          <div
            key={b.from}
            className="flex h-full min-w-0 flex-1 cursor-default items-end"
            onMouseEnter={() => setHovered(i)}
          >
            <div
              className={`w-full rounded-t-[4px] ${hovered === i ? 'bg-ink' : 'bg-visitors'}`}
              style={{ height: b.events ? `max(2px, ${(b.events / max) * 100}%)` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-label text-muted tabular-nums">
        <span>{num(d.bins[0]?.from ?? d.min)}</span>
        <span>{num(single ? d.max : (d.bins.at(-1)?.to ?? d.max))}</span>
      </div>
    </div>
  )
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{term}</dt>
      <dd className="m-0 truncate font-medium">{value}</dd>
    </div>
  )
}
