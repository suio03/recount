export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  label: string
}

/** Switches the dimension or range a view shows. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <div
      className="inline-flex flex-wrap gap-0.5 rounded-sm bg-sunken p-0.5"
      role="tablist"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className="h-6 cursor-pointer rounded-[4px] px-2 text-label font-medium text-muted hover:text-ink aria-selected:bg-surface aria-selected:text-ink aria-selected:shadow-[0_0_0_1px_var(--line)]"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
