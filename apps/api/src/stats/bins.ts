/** Drops the float noise of adding fractional widths: 0.30000000000000004 becomes 0.3. */
export const tidy = (n: number) => Number(n.toPrecision(12))

export interface Bins {
  start: number
  width: number
  count: number
}

/**
 * Equal-width bins covering `min` to `max`. Whole numbers spanning fewer than `target` values get
 * one bin each; otherwise the width is the smallest 1, 2 or 5 times a power of ten that gives
 * about `target` bins, and bins start on a multiple of it.
 */
export function binsOf(min: number, max: number, integers: boolean, target = 20): Bins {
  if (integers && max - min < target) return { start: min, width: 1, count: max - min + 1 }
  if (max === min) return { start: min, width: 1, count: 1 }
  const raw = (max - min) / target
  const power = 10 ** Math.floor(Math.log10(raw))
  let width = [1, 2, 5, 10].map((m) => tidy(m * power)).find((w) => w >= raw) ?? 10 * power
  if (integers) width = Math.max(1, Math.ceil(width))
  const start = tidy(Math.floor(min / width + 1e-9) * width)
  // A bin includes its start and excludes its end, so `max` on a boundary opens one more.
  return { start, width, count: Math.floor((max - start) / width + 1e-9) + 1 }
}
