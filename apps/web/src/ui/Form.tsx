import { Check, Copy } from 'lucide-react'
import { type InputHTMLAttributes, type ReactNode, useState } from 'react'
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

/** A value to copy, such as a key shown once or a snippet to paste. */
export function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1.5 rounded-sm bg-sunken p-3">
      <span className="text-label text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 whitespace-pre-wrap font-mono [overflow-wrap:anywhere] text-label">
          {value}
        </code>
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
export function ConfirmButton({
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
