import type { Tab } from './search'

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'journeys', label: 'Journeys' },
]

/**
 * Switches between the numbers at a glance and who tried to pay and how far people got. The
 * journeys tab carries a count of what needs a look there, so it is not missed from the overview.
 */
export function DashboardTabs({
  tab,
  onTab,
  alerts,
  alertsTitle,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  /** Failed payments and events gone quiet, shown on the journeys tab. */
  alerts: number
  alertsTitle: string
}) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Dashboard view">
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === tab}
          onClick={() => onTab(t.value)}
          className="-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 py-2 text-body font-medium text-muted hover:text-ink aria-selected:border-ink aria-selected:text-ink"
        >
          {t.label}
          {t.value === 'journeys' && alerts > 0 && (
            <span
              title={alertsTitle}
              className="rounded-full bg-down px-1.5 text-label font-semibold text-on-ink tabular-nums"
            >
              {alerts}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
