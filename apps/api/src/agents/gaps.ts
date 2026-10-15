/**
 * The event a drafted gap's line of code sends: `recount('Name', ...)`, `plausible('Name', ...)`
 * or `data-rc-event="Name"`. Undefined when the code names none, such as a property added to an
 * event the site sends already.
 */
export function gapEvent(code: string): string | undefined {
  const call = code.match(/\b(?:recount|plausible)\s*\(\s*(['"`])([^'"`]{1,120})\1/)
  if (call) return call[2]?.trim() || undefined
  const attribute = code.match(/data-rc-event\s*=\s*(['"])([^'"]{1,120})\1/)
  return attribute?.[2]?.trim() || undefined
}
