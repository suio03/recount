import { cx } from './cx'

/** An on/off setting that takes effect as soon as it is flipped. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2 text-label font-medium text-muted hover:text-ink disabled:cursor-default disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-visitors' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 size-3 rounded-full bg-surface shadow-sm transition-transform',
            checked && 'translate-x-3',
          )}
        />
      </span>
      {label}
    </button>
  )
}
