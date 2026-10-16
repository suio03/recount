import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { api, type KeyEvents, type Site } from './api'
import { Button, ErrorText, inputClass } from './ui/Form'
import { Panel } from './ui/Panel'

const errorOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const ROLES: Array<{ key: keyof KeyEvents; label: string; hint: string }> = [
  {
    key: 'activation',
    label: 'Activated',
    hint: 'Signed up or in, or otherwise started using the product.',
  },
  { key: 'start', label: 'Started paying', hint: 'Opened checkout or a payment form.' },
  {
    key: 'paid',
    label: 'Paid',
    hint: 'The payment went through. A connected payment provider counts payments instead.',
  },
  { key: 'failed', label: 'Payment failed', hint: 'Checkout or the payment broke.' },
  { key: 'closed', label: 'Gave up', hint: 'Closed or cancelled checkout.' },
]

const same = (a: KeyEvents, b: KeyEvents) =>
  ROLES.every(({ key }) => a[key].join('\n') === b[key].join('\n'))

/**
 * Which custom events mean activating and paying, for the dashboard's activation and payment
 * figures and the people who tried to pay. Guessed from the event names until saved here.
 */
export function KeyEventsSettings({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const setup = useQuery({
    queryKey: ['key-events', site.id],
    queryFn: () => api.keyEvents(site.id),
  })
  const [draft, setDraft] = useState<KeyEvents>()
  const save = useMutation({
    mutationFn: (keyEvents: KeyEvents | null) => api.updateSite(site.id, { keyEvents }),
    onSuccess: (updated) => {
      setDraft(undefined)
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        all?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      )
      queryClient.invalidateQueries({ queryKey: ['key-events', site.id] })
      queryClient.invalidateQueries({ queryKey: ['intent'] })
    },
  })
  if (setup.isError)
    return (
      <Panel title="Key events" id="key-events">
        <ErrorText>{errorOf(setup.error)}</ErrorText>
      </Panel>
    )
  if (!setup.data) return null
  const { guessed, names } = setup.data
  const current = draft ?? setup.data.events
  const changed = !same(current, setup.data.events)
  const taken = new Set(ROLES.flatMap(({ key }) => current[key]))
  const update = (key: keyof KeyEvents, next: string[]) => setDraft({ ...current, [key]: next })
  return (
    <Panel title="Key events" id="key-events">
      <p className="m-0 text-muted">
        Which events mean a visitor activated or tried to pay. The dashboard counts them and lists
        everyone who tried to pay.{' '}
        {guessed
          ? 'These are guessed from the event names until you save them.'
          : 'Set by your team.'}
      </p>
      <div className="grid gap-3">
        {ROLES.map(({ key, label, hint }) => (
          <div
            key={key}
            className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[180px_minmax(0,1fr)]"
          >
            <div className="grid content-start gap-0.5">
              <span className="font-medium">{label}</span>
              <span className="text-label text-muted">{hint}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {current[key].map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-xs bg-sunken py-0.5 pr-0.5 pl-1.5 font-mono text-path"
                >
                  {name}
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() =>
                      update(
                        key,
                        current[key].filter((n) => n !== name),
                      )
                    }
                    className="grid size-5 cursor-pointer place-items-center rounded-xs text-muted hover:bg-line hover:text-ink"
                  >
                    <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <select
                aria-label={`Add an event to ${label}`}
                className={`${inputClass} h-7 max-w-56 cursor-pointer text-label`}
                value=""
                onChange={(e) => e.target.value && update(key, [...current[key], e.target.value])}
              >
                <option value="">Add an event…</option>
                {names
                  .filter((n) => !taken.has(n))
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        ))}
      </div>
      {save.isError && <ErrorText>{errorOf(save.error)}</ErrorText>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={changed || guessed ? 'primary' : 'quiet'}
          disabled={save.isPending || (!changed && !guessed)}
          onClick={() => save.mutate(current)}
        >
          {guessed && !changed ? 'Keep these' : 'Save'}
        </Button>
        {changed && (
          <Button variant="quiet" onClick={() => setDraft(undefined)}>
            Undo changes
          </Button>
        )}
        {!guessed && !changed && (
          <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate(null)}>
            Guess from names again
          </Button>
        )}
        {save.isSuccess && !changed && <span className="text-label text-up">Saved.</span>}
      </div>
    </Panel>
  )
}
