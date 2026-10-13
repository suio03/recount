import { X } from 'lucide-react'
import type { FilterKey, Filters } from '../api'
import { cx } from '../ui/cx'
import { FILTER_KEYS, FILTER_LABELS, filterValueLabel, MONO_FILTERS } from './filters'

/** The active filters as removable chips. Hidden when nothing is filtered. */
export function FilterBar({
  filters,
  onRemove,
  onClear,
}: {
  filters: Filters
  onRemove: (key: FilterKey) => void
  onClear: () => void
}) {
  const active = FILTER_KEYS.filter((k) => filters[k])
  if (active.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {active.map((key) => {
        const value = filters[key] as string
        return (
          <span
            key={key}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface pr-1 pl-2.5"
          >
            <span className="text-label text-muted">{FILTER_LABELS[key]}</span>
            <span className={cx('font-medium', MONO_FILTERS.has(key) && 'font-mono text-path')}>
              {filterValueLabel(key, value)}
            </span>
            <button
              type="button"
              onClick={() => onRemove(key)}
              aria-label={`Remove ${FILTER_LABELS[key]} filter`}
              className="grid size-5 cursor-pointer place-items-center rounded-xs text-muted hover:bg-sunken hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        )
      })}
      {active.length > 1 && (
        <button
          type="button"
          onClick={onClear}
          className="h-7 cursor-pointer rounded-sm px-2 text-label font-medium text-muted hover:text-ink"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
