import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api } from './api'

/** Asked once per browser: the API trades ADMIN_TOKEN for a session cookie. */
export function SignIn() {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const signIn = useMutation({
    mutationFn: api.signIn,
    onSuccess: () => queryClient.invalidateQueries(),
  })
  const status = signIn.error instanceof ApiError ? signIn.error.status : undefined
  const wrong = status === 401

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (token) signIn.mutate(token)
      }}
      className="mx-auto mt-[12vh] grid w-full max-w-sm gap-3 rounded-md border border-line bg-surface p-5"
    >
      <h1 className="m-0 text-base font-semibold">Sign in to Recount</h1>
      <label className="grid gap-1.5 text-label font-medium text-muted">
        Admin token
        <input
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-invalid={wrong}
          className="h-9 rounded-sm border border-line bg-surface px-2.5 font-mono text-body text-ink aria-invalid:border-down"
        />
      </label>
      {signIn.isError && (
        <p className="m-0 text-label text-down">
          {wrong
            ? 'That is not the admin token.'
            : status === 429
              ? 'Too many wrong tokens. Try again in 15 minutes.'
              : `Could not sign in: ${String(signIn.error)}`}
        </p>
      )}
      <button
        type="submit"
        disabled={!token || signIn.isPending}
        className="h-9 cursor-pointer rounded-sm bg-ink text-body font-medium text-on-ink disabled:cursor-default disabled:opacity-50"
      >
        Sign in
      </button>
      <p className="m-0 text-label text-muted">The ADMIN_TOKEN set on the server.</p>
    </form>
  )
}
