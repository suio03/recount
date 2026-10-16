import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CreditCard, Globe, Link2, LoaderCircle, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AgentSettings } from './AgentSettings'
import { api, type Me, type RevenueSource, type Site, type SiteChange } from './api'
import { DraftSettings } from './DraftSettings'
import { FunnelSettings, GoalSettings } from './GoalSettings'
import { KeyEventsSettings } from './KeyEventsSettings'
import { Button, ConfirmButton, CopyBox, ErrorText, Field, inputClass } from './ui/Form'
import { Panel } from './ui/Panel'
import { SegmentedControl } from './ui/SegmentedControl'

const errorOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** Every IANA timezone the browser knows, with `current` kept even if it does not. */
function useTimezones(current: string) {
  return useMemo(() => {
    const all = Intl.supportedValuesOf?.('timeZone') ?? []
    const names = all.includes('UTC') ? all : ['UTC', ...all]
    return names.includes(current) ? names : [current, ...names]
  }, [current])
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const timezones = useTimezones(value)
  return (
    <label className="grid gap-1.5 text-label font-medium text-muted">
      Timezone
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {timezones.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
      <span className="font-normal">Days and hours on the dashboard start in this timezone.</span>
    </label>
  )
}

/** Adds a site to one of the teams the person administers. */
export function NewSite({ me, onCreated }: { me: Me; onCreated: (site: Site) => void }) {
  const queryClient = useQueryClient()
  const teams = me.orgs.filter((o) => o.role !== 'viewer')
  const [domain, setDomain] = useState('')
  const [timezone, setTimezone] = useState(browserTimezone)
  const [currency, setCurrency] = useState('USD')
  const [org, setOrg] = useState(teams[0]?.id)
  const create = useMutation({
    mutationFn: () =>
      api.createSite({ domain, timezone, currency, org: teams.length > 1 ? org : undefined }),
    onSuccess: (site) => {
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        [...(all ?? []), site].sort((a, b) => a.domain.localeCompare(b.domain)),
      )
      onCreated(site)
    },
  })
  return (
    <div className="grid max-w-3xl gap-3">
      <Panel title="Add a site">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Field
            label="Domain"
            placeholder="example.com"
            required
            autoFocus
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            hint="Without www. Subdomains like blog.example.com are separate sites."
          />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TimezoneSelect value={timezone} onChange={setTimezone} />
            <Field
              label="Currency"
              required
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              hint="For revenue."
            />
          </div>
          {teams.length > 1 && (
            <label className="grid gap-1.5 text-label font-medium text-muted">
              Team
              <select className={inputClass} value={org} onChange={(e) => setOrg(e.target.value)}>
                {teams.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {create.isError && <ErrorText>{errorOf(create.error)}</ErrorText>}
          <div>
            <Button
              type="submit"
              disabled={create.isPending || !domain.trim()}
              className="inline-flex items-center gap-1.5"
            >
              <Globe className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Add site
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}

/** A site's install snippet, its settings, goals and funnels, and deleting it. */
export function SiteSettings({ site, onDeleted }: { site: Site; onDeleted: () => void }) {
  return (
    <div className="grid max-w-3xl gap-3">
      <Install site={site} />
      <General key={site.id} site={site} />
      <DraftSettings key={`drafts-${site.id}`} site={site} />
      <AgentSettings key={`agents-${site.id}`} site={site} />
      <GoalSettings key={`goals-${site.id}`} site={site} />
      <FunnelSettings key={`funnels-${site.id}`} site={site} />
      <KeyEventsSettings key={`key-events-${site.id}`} site={site} />
      <Revenue key={`revenue-${site.id}`} site={site} />
      <PublicLink site={site} />
      <DeleteSite site={site} onDeleted={onDeleted} />
    </div>
  )
}

const REPLAY_RATES = [
  { value: '0', label: 'Off' },
  { value: '0.1', label: '10%' },
  { value: '0.25', label: '25%' },
  { value: '1', label: 'All' },
] as const

type Mode = 'cookie' | 'cookieless'

/** Builds the script tag from the options the tracker reads, and waits for its first event. */
function Install({ site }: { site: Site }) {
  const [mode, setMode] = useState<Mode>('cookie')
  const [replay, setReplay] = useState<(typeof REPLAY_RATES)[number]['value']>('0')
  // Keeps asking until the first event arrives; the list carries each site's first event.
  useQuery({
    queryKey: ['sites'],
    queryFn: api.sites,
    refetchInterval: site.firstEvent ? false : 4000,
  })
  const attrs = [`data-site="${site.domain}"`]
  if (mode === 'cookieless') attrs.push('data-mode="cookieless"')
  else if (replay !== '0') attrs.push(`data-replay="${replay}"`)
  const snippet = `<script defer src="${window.location.origin}/js/script.js" ${attrs.join(' ')}></script>`
  return (
    <Panel title="Install">
      <p className="m-0 text-body text-muted">
        Paste this into the <code className="font-mono text-path">&lt;head&gt;</code> of every page
        on {site.domain}.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-2 text-label font-medium text-muted">
          Visitors
          <SegmentedControl
            label="How visitors are told apart"
            options={[
              { value: 'cookie', label: 'Cookie' },
              { value: 'cookieless', label: 'Cookieless' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </span>
        {mode === 'cookie' && (
          <span className="flex items-center gap-2 text-label font-medium text-muted">
            Record sessions
            <SegmentedControl
              label="Share of sessions to record"
              options={REPLAY_RATES}
              value={replay}
              onChange={setReplay}
            />
          </span>
        )}
      </div>
      <p className="m-0 text-label text-muted">
        {mode === 'cookie'
          ? 'A first-party cookie follows a visitor across days, so journeys and revenue attribution work.'
          : 'Nothing is stored in the browser. A visitor is counted again each day, and sessions cannot be recorded.'}
        {mode === 'cookie' &&
          replay !== '0' &&
          ' Recordings mask every input and any text marked data-rc-mask.'}
      </p>
      <CopyBox key={snippet} label="Script tag" value={snippet} />
      <FirstEvent site={site} />
    </Panel>
  )
}

function FirstEvent({ site }: { site: Site }) {
  if (site.firstEvent)
    return (
      <p className="m-0 flex items-center gap-1.5 text-label text-up">
        <CircleCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
        Receiving events since{' '}
        {new Date(site.firstEvent).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        .
      </p>
    )
  return (
    <p className="m-0 flex items-center gap-1.5 text-label text-muted">
      <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
      Waiting for the first pageview. Open {site.domain} in a browser once the script is in place;
      visits from localhost are not counted.
    </p>
  )
}

function General({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(site.name)
  const [timezone, setTimezone] = useState(site.timezone)
  const [currency, setCurrency] = useState(site.currency)
  const change: SiteChange = {}
  if (name.trim() !== site.name) change.name = name.trim()
  if (timezone !== site.timezone) change.timezone = timezone
  if (currency !== site.currency) change.currency = currency
  const save = useMutation({
    mutationFn: () => api.updateSite(site.id, change),
    onSuccess: (updated) =>
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        all?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      ),
  })
  return (
    <Panel title="General">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TimezoneSelect value={timezone} onChange={setTimezone} />
          <Field
            label="Currency"
            required
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            hint="Must match the currency your payment provider settles in."
          />
        </div>
        {save.isError && <ErrorText>{errorOf(save.error)}</ErrorText>}
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="quiet"
            disabled={save.isPending || Object.keys(change).length === 0 || !name.trim()}
          >
            Save
          </Button>
          {save.isSuccess && Object.keys(change).length === 0 && (
            <span className="text-label text-up">Saved.</span>
          )}
        </div>
      </form>
    </Panel>
  )
}

/** A read-only dashboard anyone with the link can open, like a public stats page. */
function PublicLink({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (on: boolean) => (on ? api.share(site.id) : api.unshare(site.id)),
    onSuccess: (updated) =>
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        all?.map((s) => (s.id === updated.id ? { ...s, shareToken: updated.shareToken } : s)),
      ),
  })
  const link = site.shareToken && `${window.location.origin}/share/${site.shareToken}`
  return (
    <Panel title="Public link">
      <p className="m-0 text-body text-muted">
        Anyone with the link sees this site's dashboard without signing in: visitors, sources,
        pages, goals and revenue. Not the AI reading or recorded sessions.
      </p>
      {link && <CopyBox label="Link" value={link} />}
      <div className="flex flex-wrap items-center gap-2">
        {link ? (
          <>
            <ConfirmButton
              label="New link"
              confirm="Stop the old link"
              disabled={change.isPending}
              onConfirm={() => change.mutate(true)}
            />
            <ConfirmButton
              label="Turn off"
              confirm="Turn off the link"
              disabled={change.isPending}
              onConfirm={() => change.mutate(false)}
            />
          </>
        ) : (
          <Button
            variant="quiet"
            className="h-8"
            disabled={change.isPending}
            onClick={() => change.mutate(true)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Link2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Create link
            </span>
          </Button>
        )}
      </div>
      {change.isError && <ErrorText>{errorOf(change.error)}</ErrorText>}
    </Panel>
  )
}

function DeleteSite({ site, onDeleted }: { site: Site; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: () => api.deleteSite(site.id),
    onSuccess: () => {
      queryClient.setQueryData<Site[]>(['sites'], (all) => all?.filter((s) => s.id !== site.id))
      onDeleted()
    },
  })
  return (
    <Panel title="Delete site">
      <p className="m-0 text-body text-muted">
        Deletes {site.domain} with all its pageviews, events, payments and recordings. This cannot
        be undone. Events sent afterwards are ignored.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Field
            label={`Type ${site.domain} to confirm`}
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <ConfirmButton
          label="Delete site"
          confirm="Delete for good"
          disabled={typed.trim().toLowerCase() !== site.domain || remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </div>
      {remove.isError && <ErrorText>{errorOf(remove.error)}</ErrorText>}
    </Panel>
  )
}

const ago = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** `project=scribix, plan=pro` as custom data to match, or an error. */
function parseMatch(text: string): Record<string, string> | string {
  const match: Record<string, string> = {}
  for (const pair of text.split(',').map((p) => p.trim())) {
    if (!pair) continue
    const at = pair.indexOf('=')
    if (at < 1) return `Write each filter as key=value, not "${pair}"`
    match[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
  }
  return match
}

/** Connects Paddle with an API key, which the server checks and stores encrypted. */
function Revenue({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const key = ['revenue', site.id]
  const sources = useQuery({
    queryKey: key,
    queryFn: () => api.revenueSources(site.id),
    // A sync runs in the background; keep asking until it is done.
    refetchInterval: (q) => (q.state.data?.sources.some((s) => s.syncing) ? 2000 : false),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key })
    // Newly synced payments change the revenue on the dashboard.
    queryClient.invalidateQueries({ queryKey: ['main'] })
  }
  const [apiKey, setApiKey] = useState('')
  const [filter, setFilter] = useState('')
  const match = parseMatch(filter)
  const connect = useMutation({
    mutationFn: () =>
      api.connectRevenue(site.id, { key: apiKey, match: match as Record<string, string> }),
    onSuccess: () => {
      setApiKey('')
      setFilter('')
      refresh()
    },
  })
  const sync = useMutation({
    mutationFn: (id: string) => api.syncRevenue(site.id, id),
    onSuccess: refresh,
  })
  const disconnect = useMutation({
    mutationFn: (id: string) => api.disconnectRevenue(site.id, id),
    onSuccess: refresh,
  })
  const list = sources.data?.sources ?? []
  const stored = list.find((s) => s.keyHint !== null)
  return (
    <Panel title="Revenue" id="revenue">
      <p className="m-0 text-body text-muted">
        Payments from Paddle are synced every 15 minutes and credited to the visitor who paid. Put{' '}
        <code className="font-mono text-path">recount.ids()</code> in the checkout&apos;s{' '}
        <code className="font-mono text-path">customData</code> so each payment finds its visitor.
      </p>
      {sources.isError && <ErrorText>{errorOf(sources.error)}</ErrorText>}
      {list.length > 0 && (
        <ul className="m-0 grid list-none p-0">
          {list.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              busy={sync.isPending || disconnect.isPending}
              onSync={() => sync.mutate(s.id)}
              onDisconnect={() => disconnect.mutate(s.id)}
            />
          ))}
        </ul>
      )}
      {(sync.isError || disconnect.isError) && (
        <ErrorText>{errorOf(sync.error ?? disconnect.error)}</ErrorText>
      )}
      {sources.data && !sources.data.canStoreKeys ? (
        <p className="m-0 text-label text-muted">
          To connect a provider here, set <code className="font-mono">ENCRYPTION_KEY</code> on the
          server to a long random string; keys are stored encrypted with it.
        </p>
      ) : (
        <form
          className="grid gap-3 border-line border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            connect.mutate()
          }}
        >
          <Field
            label={stored ? 'Replace the Paddle API key' : 'Paddle API key'}
            type="password"
            autoComplete="off"
            required
            placeholder="pdl_live_apikey_…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            hint="Create one in Paddle under Developer tools → Authentication with transaction.read and adjustment.read. Sandbox keys work too."
          />
          <Field
            label="Only transactions whose custom data has (optional)"
            placeholder="project=example"
            value={filter}
            aria-invalid={typeof match === 'string'}
            onChange={(e) => setFilter(e.target.value)}
            hint="For a Paddle account that bills several products. Separate several with commas."
          />
          {typeof match === 'string' && <ErrorText>{match}</ErrorText>}
          {connect.isError && <ErrorText>{errorOf(connect.error)}</ErrorText>}
          <div>
            <Button
              type="submit"
              disabled={connect.isPending || !apiKey.trim() || typeof match === 'string'}
              className="inline-flex items-center gap-1.5"
            >
              <CreditCard className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {connect.isPending ? 'Checking the key…' : stored ? 'Replace key' : 'Connect Paddle'}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}

function SourceRow({
  source,
  busy,
  onSync,
  onDisconnect,
}: {
  source: RevenueSource
  busy: boolean
  onSync: () => void
  onDisconnect: () => void
}) {
  const filters = Object.entries(source.match)
  return (
    <li className="grid gap-1 border-line border-t py-2 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-body font-medium">
            Paddle{' '}
            <span className="font-normal text-muted">
              {source.keyHint ? (
                <>
                  key ending <code className="font-mono">{source.keyHint}</code>
                </>
              ) : (
                <>
                  key in <code className="font-mono">{source.keyEnv}</code>
                </>
              )}
              {filters.length > 0 && ` · only ${filters.map(([k, v]) => `${k}=${v}`).join(', ')}`}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-label text-muted">
            {source.syncing ? (
              <>
                <LoaderCircle
                  className="size-3.5 animate-spin"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                Syncing{source.syncedAt ? '' : ' the whole history, which can take a few minutes'}…
              </>
            ) : source.syncedAt ? (
              `Synced ${ago(source.syncedAt)}`
            ) : (
              'Not synced yet'
            )}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Button
            variant="quiet"
            className="inline-flex h-8 items-center gap-1.5"
            disabled={busy || source.syncing}
            onClick={onSync}
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Sync now
          </Button>
          <ConfirmButton
            label="Disconnect"
            confirm="Confirm disconnect"
            disabled={busy}
            onConfirm={onDisconnect}
          />
        </span>
      </div>
      {source.lastError && (
        <p className="m-0 whitespace-pre-line text-label text-down">{source.lastError}</p>
      )}
    </li>
  )
}
