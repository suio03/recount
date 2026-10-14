import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { type ApiKey, api, type Me, type Org, type Role, type User } from './api'
import { Button, ErrorText, Field, inputClass } from './ui/Form'
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

/** The signed-in person's account, their teams and the teams' API keys. */
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
    <Panel title="Account">
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
        <Secret
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
        <Secret label="Copy the key now. It is not shown again." value={create.data.key} />
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

/** A value shown once, with a copy button. */
function Secret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1.5 rounded-sm bg-sunken p-3">
      <span className="text-label text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-label">{value}</code>
        <button
          type="button"
          aria-label="Copy"
          title="Copy"
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-sm text-muted hover:bg-surface hover:text-ink"
        >
          {copied ? (
            <Check className="size-4" strokeWidth={1.75} />
          ) : (
            <Copy className="size-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </div>
  )
}

/** A destructive action that asks once more inline instead of in a browser dialog. */
function ConfirmButton({
  label,
  confirm,
  onConfirm,
  disabled,
}: {
  label: string
  confirm: string
  onConfirm: () => void
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  return (
    <Button
      variant="quiet"
      className={armed ? 'h-8 border-down text-down' : 'h-8'}
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirm : label}
    </Button>
  )
}
