import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, KeyRound, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { type ApiKey, api, type Me, type Org, type Role, type SiteUsage, type User } from './api'
import { Button, ConfirmButton, CopyBox, ErrorText, Field, inputClass } from './ui/Form'
import { Panel } from './ui/Panel'

const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 }
const atLeast = (role: Role, needed: Role) => RANK[role] >= RANK[needed]
/** Mirrors the API: admins manage admins and viewers; only owners touch ownership. */
const canAssign = (actor: Role, role: Role) =>
  actor === 'owner' || (actor === 'admin' && role !== 'owner')

const ROLES: Array<{ value: Role; label: string; hint: string }> = [
  { value: 'viewer', label: 'Viewer', hint: 'Sees the dashboards' },
  { value: 'admin', label: 'Admin', hint: 'Also manages sites, people and API keys' },
  { value: 'owner', label: 'Owner', hint: 'Also gives and takes away ownership' },
]

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

const errorOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The signed-in person's account, their teams, the teams' usage and API keys. */
export function Settings({ me }: { me: Me }) {
  const [orgId, setOrgId] = useState(me.orgs[0]?.id)
  const org = me.orgs.find((o) => o.id === orgId) ?? me.orgs[0]
  return (
    <div className="grid max-w-3xl gap-3">
      {me.user && <Account user={me.user} />}
      {me.orgs.length > 1 && (
        <label className="flex items-center gap-2 text-label font-medium text-muted">
          Team
          <select className={inputClass} value={org?.id} onChange={(e) => setOrgId(e.target.value)}>
            {me.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {org && <Team key={org.id} org={org} me={me.user} />}
      {org && <UsagePanel key={`usage-${org.id}`} org={org} />}
      {org && atLeast(org.role, 'admin') && <Keys key={`keys-${org.id}`} org={org} />}
    </div>
  )
}

function Account({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(user.name)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const rename = useMutation({
    mutationFn: () => api.updateMe({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  const password = useMutation({
    mutationFn: () => api.updateMe({ password: { current, next } }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
    },
  })
  return (
    <Panel title="Profile">
      <p className="m-0 text-body text-muted">{user.email}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          rename.mutate()
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button
          type="submit"
          variant="quiet"
          disabled={rename.isPending || !name.trim() || name === user.name}
        >
          Save
        </Button>
      </form>
      {rename.isError && <ErrorText>{errorOf(rename.error)}</ErrorText>}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          password.mutate()
        }}
      >
        <div className="min-w-48 flex-1">
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="min-w-48 flex-1">
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <Button type="submit" variant="quiet" disabled={password.isPending}>
          Change password
        </Button>
      </form>
      {password.isError && <ErrorText>{errorOf(password.error)}</ErrorText>}
      {password.isSuccess && (
        <p className="m-0 text-label text-up">Password changed. Other browsers are signed out.</p>
      )}
    </Panel>
  )
}

function Team({ org, me }: { org: Org; me: User | null }) {
  const queryClient = useQueryClient()
  const members = useQuery({ queryKey: ['members', org.id], queryFn: () => api.members(org.id) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members', org.id] })
  const admin = atLeast(org.role, 'admin')
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.setRole(org.id, userId, role),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(org.id, userId),
    onSuccess: (_, userId) => {
      // Leaving the team takes its sites away too.
      if (userId === me?.id) queryClient.invalidateQueries()
      else refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.deleteInvite(org.id, id),
    onSettled: refresh,
  })

  return (
    <Panel title="Team">
      {admin ? <RenameOrg org={org} /> : <p className="m-0 text-body">{org.name}</p>}
      {members.isError && <ErrorText>{errorOf(members.error)}</ErrorText>}
      <ul className="m-0 grid list-none gap-0 p-0">
        {members.data?.members.map((m, _, all) => {
          const self = m.id === me?.id
          // The API refuses to leave a team without an owner, so the button would only fail.
          const lastOwner = m.role === 'owner' && all.filter((o) => o.role === 'owner').length === 1
          const editable = !self && canAssign(org.role, m.role)
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 border-line border-t py-2 first:border-t-0"
            >
              <span className="min-w-0">
                <span className="block truncate text-body font-medium">
                  {m.name}
                  {self && <span className="font-normal text-muted"> (you)</span>}
                </span>
                <span className="block truncate text-label text-muted">{m.email}</span>
              </span>
              <span className="flex items-center gap-2">
                {editable ? (
                  <select
                    aria-label={`Role of ${m.name}`}
                    className={`${inputClass} h-8`}
                    value={m.role}
                    disabled={setRole.isPending}
                    onChange={(e) => setRole.mutate({ userId: m.id, role: e.target.value as Role })}
                  >
                    {ROLES.filter((r) => canAssign(org.role, r.value)).map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-label text-muted capitalize">{m.role}</span>
                )}
                {(editable || (self && !lastOwner)) && (
                  <ConfirmButton
                    label={self ? 'Leave' : 'Remove'}
                    confirm={self ? 'Leave team' : 'Confirm remove'}
                    disabled={remove.isPending}
                    onConfirm={() => remove.mutate(m.id)}
                  />
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {setRole.isError && <ErrorText>{errorOf(setRole.error)}</ErrorText>}
      {remove.isError && <ErrorText>{errorOf(remove.error)}</ErrorText>}

      {members.data && members.data.invites.length > 0 && (
        <div className="grid gap-1">
          <h3 className="m-0 text-label font-semibold text-muted">Invited</h3>
          {members.data.invites.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="text-body">
                {i.email}{' '}
                <span className="text-label text-muted">
                  {i.role}, link expires {date(i.expiresAt)}
                </span>
              </span>
              {admin && (
                <Button
                  variant="quiet"
                  className="h-8"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(i.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {admin && <InviteForm org={org} onInvited={refresh} />}
    </Panel>
  )
}

function RenameOrg({ org }: { org: Org }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(org.name)
  const rename = useMutation({
    mutationFn: () => api.renameOrg(org.id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        rename.mutate()
      }}
    >
      <div className="min-w-56 flex-1">
        <Field label="Team name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button
        type="submit"
        variant="quiet"
        disabled={rename.isPending || !name.trim() || name === org.name}
      >
        Rename
      </Button>
      {rename.isError && <ErrorText>{errorOf(rename.error)}</ErrorText>}
    </form>
  )
}

/** Invites by email. There is no mail yet, so the link is shown for the inviter to pass on. */
function InviteForm({ org, onInvited }: { org: Org; onInvited: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const invite = useMutation({
    mutationFn: () => api.createInvite(org.id, email, role),
    onSuccess: () => {
      setEmail('')
      onInvited()
    },
  })
  const link = invite.data && `${window.location.origin}/#invite=${invite.data.token}`
  return (
    <div className="grid gap-2 border-line border-t pt-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          invite.mutate()
        }}
      >
        <div className="min-w-56 flex-1">
          <Field
            label="Invite by email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <label className="grid gap-1.5 text-label font-medium text-muted">
          Role
          <select
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.filter((r) => canAssign(org.role, r.value)).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          disabled={invite.isPending}
          className="inline-flex items-center gap-1.5"
        >
          <UserPlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Invite
        </Button>
      </form>
      <p className="m-0 text-label text-muted">{ROLES.find((r) => r.value === role)?.hint}.</p>
      {invite.isError && <ErrorText>{errorOf(invite.error)}</ErrorText>}
      {link && invite.data && (
        <CopyBox
          label={`Send this link to ${invite.data.email}. It works once, for 7 days.`}
          value={link}
        />
      )}
    </div>
  )
}

function Keys({ org }: { org: Org }) {
  const queryClient = useQueryClient()
  const keys = useQuery({ queryKey: ['keys', org.id], queryFn: () => api.keys(org.id) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['keys', org.id] })
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => api.createKey(org.id, name),
    onSuccess: () => {
      setName('')
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteKey(org.id, id),
    onSettled: refresh,
  })
  return (
    <Panel title="API keys">
      <p className="m-0 text-body text-muted">
        For scripts: send{' '}
        <code className="font-mono text-path">Authorization: Bearer &lt;key&gt;</code>. A key can do
        what an admin of {org.name} can.
      </p>
      {keys.isError && <ErrorText>{errorOf(keys.error)}</ErrorText>}
      {keys.data && keys.data.length > 0 && (
        <ul className="m-0 grid list-none p-0">
          {keys.data.map((k) => (
            <KeyRow key={k.id} apiKey={k} onDelete={() => remove.mutate(k.id)} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div className="min-w-56 flex-1">
          <Field
            label="New key"
            placeholder="What it is for, like deploy script"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          disabled={create.isPending}
          className="inline-flex items-center gap-1.5"
        >
          <KeyRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Create key
        </Button>
      </form>
      {create.isError && <ErrorText>{errorOf(create.error)}</ErrorText>}
      {create.data && (
        <CopyBox label="Copy the key now. It is not shown again." value={create.data.key} />
      )}
    </Panel>
  )
}

function KeyRow({ apiKey, onDelete }: { apiKey: ApiKey; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-line border-t py-2 first:border-t-0">
      <span className="min-w-0">
        <span className="block text-body font-medium">{apiKey.name}</span>
        <span className="block text-label text-muted">
          <code className="font-mono">{apiKey.prefix}…</code> · created {date(apiKey.createdAt)} ·{' '}
          {apiKey.lastUsedAt ? `last used ${date(apiKey.lastUsedAt)}` : 'never used'}
        </span>
      </span>
      <ConfirmButton label="Delete" confirm="Confirm delete" onConfirm={onDelete} />
    </li>
  )
}

/** Dollars from micros, with cents past a dollar and enough digits to show a single call. */
const usd = (micros: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: micros > 0 && micros < 1_000_000 ? 4 : 2,
  }).format(micros / 1_000_000)

const thisMonth = () => new Date().toISOString().slice(0, 7)

/** `YYYY-MM` moved by `by` months. */
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7)
}

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** What the team's sites used in a month, and today's AI spend against the daily budget. */
function UsagePanel({ org }: { org: Org }) {
  const [month, setMonth] = useState(thisMonth)
  const usage = useQuery({
    queryKey: ['usage', org.id, month],
    queryFn: () => api.usage(org.id, month),
  })
  const data = usage.data
  const total = data?.sites.reduce<SiteUsage>(
    (sum, s) => ({
      ...sum,
      pageviews: sum.pageviews + s.pageviews,
      recordings: sum.recordings + s.recordings,
      aiCalls: sum.aiCalls + s.aiCalls,
      aiCostMicros: sum.aiCostMicros + s.aiCostMicros,
    }),
    { siteId: null, domain: 'Total', pageviews: 0, recordings: 0, aiCalls: 0, aiCostMicros: 0 },
  )
  const latest = month === thisMonth()
  const step =
    'grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink disabled:cursor-default disabled:opacity-40'
  return (
    <Panel
      title="Usage"
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={step}
            aria-label="Previous month"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
          <span className="min-w-32 text-center text-label font-medium tabular-nums">
            {monthLabel(month)}
          </span>
          <button
            type="button"
            className={step}
            aria-label="Next month"
            disabled={latest}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      }
    >
      {usage.isError && <ErrorText>{errorOf(usage.error)}</ErrorText>}
      {data && <AiToday {...data.ai} />}
      {data && total && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-body tabular-nums">
            <thead>
              <tr className="text-label text-muted">
                <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                  Site
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Pageviews
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Recordings
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  AI calls
                </th>
                <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                  AI cost
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data.sites, total].map((s) => (
                <tr
                  key={s.siteId ?? s.domain ?? 'deleted'}
                  className={
                    s === total ? 'border-line border-t font-medium' : 'border-line border-t'
                  }
                >
                  <td className="truncate py-1.5 pr-2">
                    {s.domain ?? <span className="text-muted">Deleted sites</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">{s.pageviews.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{s.recordings.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{s.aiCalls.toLocaleString()}</td>
                  <td className="py-1.5 pl-2 text-right">{usd(s.aiCostMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-label text-muted">
        Months and days are in UTC. AI cost is estimated from tokens at standard API prices.
      </p>
    </Panel>
  )
}

function AiToday({
  todayMicros,
  dailyBudgetMicros,
}: {
  todayMicros: number
  dailyBudgetMicros: number
}) {
  const share = dailyBudgetMicros > 0 ? Math.min(1, todayMicros / dailyBudgetMicros) : 1
  const spent = todayMicros >= dailyBudgetMicros
  return (
    <div className="grid gap-1.5 rounded-sm bg-sunken p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-label">
        <span className="font-medium">AI today</span>
        <span className="tabular-nums text-muted">
          {usd(todayMicros)} of {usd(dailyBudgetMicros)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="meter"
        aria-label="AI budget used today"
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={spent ? 'h-full bg-down' : 'h-full bg-ink'}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      {spent && (
        <span className="text-label text-down">
          Spent. Readings, summaries and patterns resume at midnight UTC.
        </span>
      )}
    </div>
  )
}
