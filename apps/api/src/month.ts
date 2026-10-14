/** `YYYY-MM` to the month's first instant and the next month's, in UTC. */
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) }
}
