import { describe, expect, it } from 'vitest'
import { binsOf } from './bins'

describe('binsOf', () => {
  it('gives few whole numbers a bin each', () => {
    expect(binsOf(1, 5, true)).toEqual({ start: 1, width: 1, count: 5 })
    expect(binsOf(3, 3, true)).toEqual({ start: 3, width: 1, count: 1 })
  })

  it('rounds the width to 1, 2 or 5 times a power of ten', () => {
    expect(binsOf(0, 100, true)).toEqual({ start: 0, width: 5, count: 21 })
    expect(binsOf(12, 370, true)).toEqual({ start: 0, width: 20, count: 19 })
    expect(binsOf(0.1, 0.9, false)).toEqual({ start: 0.1, width: 0.05, count: 17 })
  })

  it('keeps whole numbers in whole-number bins', () => {
    expect(binsOf(0, 30, true).width).toBe(2)
  })

  it('makes one bin of a single fractional value', () => {
    expect(binsOf(2.5, 2.5, false)).toEqual({ start: 2.5, width: 1, count: 1 })
  })
})
