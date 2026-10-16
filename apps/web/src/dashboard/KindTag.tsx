import { cx } from '../ui/cx'

/** Marks a written line as stated by the numbers it cites, or as a guess from them. */
export function KindTag({ kind }: { kind: 'fact' | 'guess' }) {
  return (
    <span
      className={cx(
        'w-fit rounded-full px-2 py-px text-tick font-semibold uppercase tracking-[0.06em]',
        kind === 'fact' ? 'bg-ink text-on-ink' : 'border border-dashed border-muted text-muted',
      )}
      title={
        kind === 'fact'
          ? 'Stated by the numbers it cites'
          : 'An explanation the numbers suggest but do not show'
      }
    >
      {kind === 'fact' ? 'Fact' : 'Guess'}
    </span>
  )
}
