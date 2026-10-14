import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export const inputClass =
  'h-9 rounded-sm border border-line bg-surface px-2.5 text-body text-ink aria-invalid:border-down'

/** A labelled input. */
export function Field({
  label,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-label font-medium text-muted">
      {label}
      <input {...input} className={cx(inputClass, className)} />
      {hint && <span className="font-normal">{hint}</span>}
    </label>
  )
}

export function Button({
  children,
  variant = 'primary',
  className,
  ...button
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  return (
    <button
      type="button"
      {...button}
      className={cx(
        'h-9 cursor-pointer rounded-sm px-3 text-body font-medium disabled:cursor-default disabled:opacity-50',
        variant === 'primary'
          ? 'bg-ink text-on-ink'
          : 'border border-line bg-surface text-ink hover:bg-sunken',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A small centered card for the pages shown before the dashboard: sign-in, setup, invites. */
export function FormCard({
  title,
  children,
  onSubmit,
}: {
  title: string
  children: ReactNode
  onSubmit: () => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="mx-auto mt-[12vh] grid w-full max-w-sm gap-3 rounded-md border border-line bg-surface p-5"
    >
      <h1 className="m-0 text-base font-semibold">{title}</h1>
      {children}
    </form>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="m-0 text-label text-down">{children}</p>
}
