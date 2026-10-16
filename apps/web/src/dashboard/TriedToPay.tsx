import { Link } from '@tanstack/react-router'
import { CreditCard } from 'lucide-react'
import type { Ending, Intent, PayingVisitor, TrailEvent } from '../api'
import { cx } from '../ui/cx'
import { countryFlag, countryName, money } from './format'
import { sourceOf } from './Traffic'
import { useWhy, type WhyContext } from './Why'

const ENDINGS: Record<Ending, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-up text-on-ink' },
  failed: { label: 'Payment failed', className: 'bg-down text-on-ink' },
  closed: { label: 'Gave up', className: 'border border-line-strong text-ink' },
  none: { label: 'Nothing after', className: 'border border-line text-muted' },
}

/**
 * Everyone who tried to pay in the range, newest first: where they came from, what they did in
 * order, and how it ended. Payment events are in the money color, failures in red.
 */
export function TriedToPay({
  intent,
  domain,
  timezone,
  canEdit,
  why,
}: {
  intent?: Intent
  /** Links to the site's settings, where the payment events are corrected. */
  domain?: string
  timezone: string
  canEdit: boolean
  /** Adds "Why?" to each person. */
  why?: WhyContext
}) {
  if (!intent) return <div id="tried" className="h-40 animate-pulse rounded-md bg-sunken/40" />
  const { totals, previous, people, events, guessed, provider } = intent
  const known =
    events.start.length + events.paid.length + events.failed.length + events.closed.length
  const settings = canEdit && domain && (
    <Link
      to="/sites/$domain/settings"
      params={{ domain }}
      hash="key-events"
      className="text-ink underline underline-offset-2"
    >
      {known ? 'Correct them in settings' : 'Say which ones do in settings'}
    </Link>
  )
  return (
    <section
      id="tried"
      className="grid min-w-0 scroll-mt-20 content-start gap-4 rounded-md border border-line bg-surface p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="m-0 flex items-center gap-2 text-title font-semibold tracking-[-0.01em]">
            <CreditCard className="size-5 text-revenue" strokeWidth={1.75} aria-hidden="true" />
            {headline(totals.tried, totals.paid)}
          </h2>
          <p className="m-0 text-label text-muted">
            The period before: {previous.tried.toLocaleString('en')} tried,{' '}
            {previous.paid.toLocaleString('en')} paid.{' '}
            {provider
              ? 'Payments are counted from your payment provider.'
              : 'Payments are counted from events, since no payment provider is connected.'}
          </p>
        </div>
        {!provider && canEdit && domain && (
          <Link
            to="/sites/$domain/settings"
            params={{ domain }}
            hash="revenue"
            className="inline-flex h-9 items-center rounded-sm border border-line px-3 text-body font-medium hover:bg-sunken"
          >
            Connect a payment provider
          </Link>
        )}
      </header>
      {known === 0 ? (
        <p className="m-0 text-muted">
          None of this site’s events look like payments yet. {settings}
          {settings && '.'}
        </p>
      ) : (
        guessed && (
          <p className="m-0 text-label text-muted">
            Guessed from event names:{' '}
            {[...events.start, ...events.failed, ...events.closed, ...events.paid].map((n, i) => (
              <span key={n}>
                {i > 0 && ', '}
                <code className="font-mono text-path text-ink">{n}</code>
              </span>
            ))}
            . {settings}
            {settings && '.'}
          </p>
        )
      )}
      {people.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3">
          {people.map((p) => (
            <PersonCard
              key={p.visitor}
              person={p}
              timezone={timezone}
              currency={intent.currency}
              why={why}
            />
          ))}
        </div>
      )}
      {totals.tried > people.length && people.length > 0 && (
        <p className="m-0 text-label text-muted">
          Showing the latest {people.length} of {totals.tried.toLocaleString('en')}.
        </p>
      )}
    </section>
  )
}

function headline(tried: number, paid: number) {
  if (tried === 0) return 'Nobody tried to pay.'
  const who =
    tried === 1 ? '1 person tried to pay.' : `${tried.toLocaleString('en')} people tried to pay.`
  if (paid === 0) return `${who} Nobody paid.`
  return `${who} ${paid.toLocaleString('en')} paid.`
}

function PersonCard({
  person: p,
  timezone,
  currency,
  why,
}: {
  person: PayingVisitor
  timezone: string
  currency: string
  why?: WhyContext
}) {
  const ask = useWhy(why, { visitor: p.visitor })
  const ending = ENDINGS[p.ending]
  const when = new Date(p.last).toLocaleString('en', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return (
    <article className="grid content-start gap-3 rounded-sm border border-line p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">
            {p.country ? (
              <>
                {countryFlag(p.country)} {countryName(p.country)}
              </>
            ) : (
              'Unknown country'
            )}
            <span className="text-muted">
              {' '}
              · {[p.device, p.browser].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="truncate text-label text-muted">
            from <span className="text-ink">{sourceOf(p)}</span>
            {p.entry && (
              <>
                {' '}
                · entered <code className="font-mono text-path text-ink">{p.entry}</code>
              </>
            )}
            {p.visits > 1 && ` · ${p.visits} visits`}
          </span>
        </div>
        <span
          className={cx(
            'shrink-0 rounded-xs px-1.5 py-0.5 text-label font-medium whitespace-nowrap',
            ending.className,
          )}
        >
          {ending.label}
          {p.amount > 0 && ` · ${money(p.amount, currency)}`}
        </span>
      </header>
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1.5 p-0">
        {p.trail.map((e, i) => (
          <li key={`${e.name}-${e.at}`} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-label text-line-strong" aria-hidden="true">
                →
              </span>
            )}
            <Step event={e} />
          </li>
        ))}
      </ol>
      <footer className="flex items-center justify-between gap-2 text-label text-muted">
        Last payment event {when}
        {ask.button}
      </footer>
      {ask.answer}
    </article>
  )
}

function Step({ event: e }: { event: TrailEvent }) {
  const pay = e.role === 'start' || e.role === 'closed' || e.role === 'interest'
  return (
    <span
      title={new Date(e.at).toLocaleString('en')}
      className={cx(
        'rounded-xs px-1.5 py-0.5 font-mono text-path',
        e.role === 'paid'
          ? 'bg-up text-on-ink'
          : e.fault || e.role === 'failed'
            ? 'bg-down/10 text-down'
            : pay
              ? 'bg-revenue-soft text-revenue'
              : 'bg-sunken text-ink',
      )}
    >
      {e.name}
      {e.n > 1 && <span className="opacity-70"> ×{e.n}</span>}
    </span>
  )
}
