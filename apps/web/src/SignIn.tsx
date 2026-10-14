import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api } from './api'
import { Button, ErrorText, Field, FormCard } from './ui/Form'

const message = (error: unknown) =>
  error instanceof ApiError && error.status === 429
    ? 'Too many wrong attempts. Try again in 15 minutes.'
    : error instanceof Error
      ? error.message
      : String(error)

/** Shown when the browser is not signed in: the sign-in form, or setup on a fresh install. */
export function SignIn() {
  const setup = useQuery({ queryKey: ['setup'], queryFn: api.setupNeeded })
  if (setup.isPending) return null
  return setup.data?.needed ? <Setup /> : <Login />
}

function Login() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const signIn = useMutation({
    mutationFn: api.signIn,
    onSuccess: () => queryClient.invalidateQueries(),
  })
  return (
    <FormCard title="Sign in to Recount" onSubmit={() => signIn.mutate({ email, password })}>
      <Field
        label="Email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-invalid={signIn.isError}
      />
      {signIn.isError && <ErrorText>{message(signIn.error)}</ErrorText>}
      <Button type="submit" disabled={!email || !password || signIn.isPending}>
        Sign in
      </Button>
      <p className="m-0 text-label text-muted">
        Forgot it? Ask whoever runs this server to reset it.
      </p>
    </FormCard>
  )
}

/** The first account on an install. The setup code in the server log proves the person runs it. */
function Setup() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ setupCode: '', name: '', email: '', password: '' })
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const setup = useMutation({
    mutationFn: api.setup,
    onSuccess: () => queryClient.invalidateQueries(),
  })
  return (
    <FormCard title="Set up Recount" onSubmit={() => setup.mutate(form)}>
      <p className="m-0 text-body text-muted">
        Create the owner account. Sites already on this server join your team.
      </p>
      <Field
        label="Setup code"
        autoComplete="off"
        spellCheck={false}
        required
        placeholder="XXXX-XXXX-XXXX-XXXX"
        value={form.setupCode}
        onChange={set('setupCode')}
        className="font-mono uppercase"
        hint="Printed in the server log at startup: “No accounts yet … setup code”."
      />
      <Field label="Name" required autoComplete="name" value={form.name} onChange={set('name')} />
      <Field
        label="Email"
        type="email"
        required
        autoComplete="username"
        value={form.email}
        onChange={set('email')}
      />
      <Field
        label="Password"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        value={form.password}
        onChange={set('password')}
        hint="At least 10 characters."
      />
      {setup.isError && <ErrorText>{message(setup.error)}</ErrorText>}
      <Button type="submit" disabled={setup.isPending}>
        Create account
      </Button>
    </FormCard>
  )
}

/** An invite link: someone new creates an account, someone with one signs in to join. */
export function AcceptInvite({ token, onDone }: { token: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.invite(token) })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const accept = useMutation({
    mutationFn: () =>
      api.acceptInvite(token, invite.data?.hasAccount ? { password } : { password, name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      onDone()
    },
  })

  if (invite.isPending) return null
  if (!invite.data)
    return (
      <FormCard title="Invite not found" onSubmit={onDone}>
        <p className="m-0 text-body text-muted">
          The link is wrong, was used already, or expired. Ask for a new one.
        </p>
        <Button type="submit">Go to Recount</Button>
      </FormCard>
    )

  const { org, email, role, hasAccount } = invite.data
  return (
    <FormCard title={`Join ${org}`} onSubmit={() => accept.mutate()}>
      <p className="m-0 text-body text-muted">
        You are invited as {role === 'viewer' ? 'a viewer' : `an ${role}`}.{' '}
        {hasAccount ? 'Sign in to accept.' : 'Create your account to accept.'}
      </p>
      <Field label="Email" type="email" autoComplete="username" value={email} readOnly />
      {!hasAccount && (
        <Field
          label="Name"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <Field
        label="Password"
        type="password"
        required
        minLength={hasAccount ? undefined : 10}
        autoComplete={hasAccount ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={hasAccount ? undefined : 'At least 10 characters.'}
      />
      {accept.isError && <ErrorText>{message(accept.error)}</ErrorText>}
      <Button type="submit" disabled={accept.isPending}>
        {hasAccount ? 'Sign in and join' : 'Create account and join'}
      </Button>
    </FormCard>
  )
}
