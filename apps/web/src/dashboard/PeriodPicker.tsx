import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { DateRange } from '../api'
import { cx } from '../ui/cx'
import { rangeLabel } from './format'
import {
  comparisonLabel,
  dayIn,
  type Period,
  PRESET_GROUPS,
  periodLabel,
  resolve,
  shift,
} from './period'

const SHORTCUTS = new Map(
  PRESET_GROUPS.flat().flatMap((p) => (p.key ? [[p.key.toLowerCase(), p.preset]] : [])),
)

/** Typing in a field or holding a modifier is never a shortcut. */
function isShortcut(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  const target = e.target as HTMLElement | null
  return !target?.closest('input, textarea, select, [contenteditable="true"]')
}

/**
 * Plausible's date picker: arrows that step the period back and forth, and a menu of presets
 * with the same keyboard shortcuts, plus a custom range.
 */
export function PeriodPicker({
  period,
  range,
  timezone,
  firstEvent,
  onChange,
}: {
  period: Period
  range: DateRange
  timezone: string
  firstEvent: string | null
  onChange: (period: Period) => void
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const earlier = shift(period, -1, timezone)
  const later = shift(period, 1, timezone)

  const choose = (next: Period) => {
    onChange(next)
    setOpen(false)
    setCustom(false)
  }

  // Latest values for the window listeners, which are attached once.
  const latest = useRef({ choose, earlier, later })
  latest.current = { choose, earlier, later }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setCustom(false)
        return
      }
      if (!isShortcut(e)) return
      const { choose, earlier, later } = latest.current
      const preset = SHORTCUTS.get(e.key.toLowerCase())
      if (preset) choose({ preset })
      else if (e.key.toLowerCase() === 'c') {
        setOpen(true)
        setCustom(true)
      } else if (e.key === 'ArrowLeft' && earlier) choose(earlier)
      else if (e.key === 'ArrowRight' && later) choose(later)
      else return
      e.preventDefault()
    }
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false)
        setCustom(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  const compared = comparisonLabel(period, range)
  const span = period.preset === 'realtime' ? 'Last 30 minutes' : rangeLabel(range)
  const detail = compared ? `${span} · ${compared}` : span
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* On narrower screens the dates move into the menu button's tooltip to keep one row. */}
      <span className="hidden text-label text-muted xl:inline">{detail}</span>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-sm bg-sunken p-0.5">
          <StepButton
            label="Earlier"
            hint="←"
            disabled={!earlier}
            onClick={() => earlier && choose(earlier)}
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </StepButton>
          <StepButton
            label="Later"
            hint="→"
            disabled={!later}
            onClick={() => later && choose(later)}
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </StepButton>
        </div>
        <div ref={box} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            title={detail}
            onClick={() => {
              setOpen((o) => !o)
              setCustom(false)
            }}
            className="inline-flex h-9 min-w-44 cursor-pointer items-center justify-between gap-2 rounded-sm border border-line bg-surface px-3 text-label font-medium hover:border-line-strong"
          >
            {periodLabel(period, timezone)}
            <ChevronDown className="size-4 text-muted" strokeWidth={1.75} />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop"
            >
              {custom ? (
                <CustomRange
                  initial={range}
                  timezone={timezone}
                  firstEvent={firstEvent}
                  onApply={(r) => choose({ preset: 'custom', ...r })}
                  onBack={() => setCustom(false)}
                />
              ) : (
                <>
                  {PRESET_GROUPS.map((group) => (
                    <div
                      key={group[0]?.preset}
                      className="border-b border-line py-1 first:pt-0 last:border-b-0"
                    >
                      {group.map((p) => (
                        <MenuItem
                          key={p.preset}
                          label={p.label}
                          shortcut={p.key}
                          current={period.preset === p.preset}
                          onClick={() => choose({ preset: p.preset })}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="border-t border-line pt-1">
                    <MenuItem
                      label="Custom Range"
                      shortcut="C"
                      current={period.preset === 'custom'}
                      onClick={() => setCustom(true)}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepButton({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string
  hint: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${hint})`}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 cursor-pointer place-items-center rounded-[4px] text-muted hover:bg-surface hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
    >
      {children}
    </button>
  )
}

function MenuItem({
  label,
  shortcut,
  current,
  onClick,
}: {
  label: string
  shortcut?: string
  current: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        'flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-label hover:bg-sunken',
        current && 'font-semibold',
      )}
    >
      {label}
      {shortcut && (
        <kbd className="rounded-[4px] border border-line px-1.5 font-mono text-tick text-muted">
          {shortcut}
        </kbd>
      )}
    </button>
  )
}

function CustomRange({
  initial,
  timezone,
  firstEvent,
  onApply,
  onBack,
}: {
  initial: DateRange
  timezone: string
  firstEvent: string | null
  onApply: (range: { from: string; to: string }) => void
  onBack: () => void
}) {
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const today = dayIn(timezone, Date.now())
  const earliest = resolve({ preset: 'all' }, timezone, firstEvent).from
  const valid = from !== '' && to !== '' && from <= to && to <= today

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) onApply({ from, to })
  }
  const field =
    'h-7 w-full rounded-sm border border-line bg-surface px-2 font-mono text-label text-ink outline-none focus:border-line-strong'
  return (
    <form onSubmit={submit} className="grid gap-2 px-3 py-2">
      <label className="grid gap-1 text-label text-muted">
        From
        <input
          type="date"
          className={field}
          value={from}
          min={earliest}
          max={to || today}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-label text-muted">
        To
        <input
          type="date"
          className={field}
          value={to}
          min={from || earliest}
          max={today}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      <div className="flex justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="h-7 cursor-pointer rounded-sm px-2 text-label text-muted hover:bg-sunken hover:text-ink"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="h-7 cursor-pointer rounded-sm bg-ink px-3 text-label font-medium text-on-ink disabled:cursor-default disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </form>
  )
}
