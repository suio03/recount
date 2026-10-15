import { describe, expect, it } from 'vitest'
import { gapEvent } from './gaps'

describe('gapEvent', () => {
  it('reads the event a call or an attribute sends', () => {
    expect(gapEvent("recount('Game Started', { props: { level } })")).toBe('Game Started')
    expect(gapEvent('window.recount("Export Downloaded")')).toBe('Export Downloaded')
    expect(gapEvent('plausible(`Signup`)')).toBe('Signup')
    expect(gapEvent('<button data-rc-event="Share Opened">')).toBe('Share Opened')
  })

  it('is undefined when the code names no event', () => {
    expect(gapEvent('<meta name="recount:page-type" content="pricing">')).toBeUndefined()
    expect(gapEvent('recount(name)')).toBeUndefined()
  })
})
