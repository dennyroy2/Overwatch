import { describe, expect, it, vi } from 'vitest'
import { whenIdle } from './camera'

describe('whenIdle', () => {
  it('runs immediately when the map has finished loading', () => {
    const once = vi.fn()
    const fn = vi.fn()
    whenIdle({ loaded: () => true, once } as never, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(once).not.toHaveBeenCalled()
  })

  it('waits for the next idle event while tiles or elevation are still loading', () => {
    let idle: () => void = () => {}
    const fn = vi.fn()
    whenIdle({ loaded: () => false, once: (_: string, cb: () => void) => { idle = cb } } as never, fn)
    expect(fn).not.toHaveBeenCalled()
    idle()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
