import { cx } from './cx'

/**
 * Recount's mark: points recorded first, three of them joined later by a rule. The points take
 * the text color; the joined ones take the visitors color.
 */
export function Logo({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="10 10 80 80" aria-hidden="true" className={cx('shrink-0', className)}>
      <path
        fill="currentColor"
        d="M10 20a10 10 0 1 0 20 0a10 10 0 1 0 -20 0ZM40 20a10 10 0 1 0 20 0a10 10 0 1 0 -20 0ZM70 20a10 10 0 1 0 20 0a10 10 0 1 0 -20 0ZM10 50a10 10 0 1 0 20 0a10 10 0 1 0 -20 0ZM40 50a10 10 0 1 0 20 0a10 10 0 1 0 -20 0ZM10 80a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z"
      />
      <path
        className="fill-visitors"
        d="M70 50A10 10 0 0 1 90 50V80A10 10 0 0 1 80 90H50A10 10 0 0 1 50 70H70Z"
      />
    </svg>
  )
}
