/**
 * heal/settle conformance — the render-settle decision. The grounding snapshot must wait until the
 * render has LANDED (the network idled OR a DOM render wave was observed) AND the DOM has since been
 * quiet (so a client-rendered view isn't captured mid-render / as a "loading…" placeholder), but must
 * NOT hang forever — the hard cap forces a snapshot. Lock every arm. The live behaviour (never-idle /
 * idle / static / spinner pages) is verified by scripts/settle-loadtest.ts; here we pin the pure math.
 */
import { test, expect } from '@playwright/test'
import { renderSettled, resolveSettle, SETTLE_QUIET_MS, SETTLE_CAP_MS, SETTLE_NETWORKIDLE_MS } from '../../heal/settle'

test('settles once landed AND the DOM has been QUIET for quietMs', () => {
  const start = 1000
  const landedAt = start + 200 // render landed (e.g. networkidle or first wave) at +200
  // last mutation was quietMs ago, landed, well within the cap → settled.
  expect(renderSettled(start + 800, start + 800 - SETTLE_QUIET_MS, start, landedAt)).toBe(true)
})

test('NOT settled before the render has LANDED (landedAt = 0), even if the DOM looks quiet', () => {
  const start = 1000
  // a `loading…` placeholder is momentarily quiet, but nothing has landed yet → keep waiting (don't
  // snapshot the placeholder). This is the trap plain DOM-quiet falls into.
  expect(renderSettled(start + 5000, start, start, 0)).toBe(false)
})

test('NOT settled while the DOM is still mutating within the quiet window', () => {
  const start = 1000
  const landedAt = start + 100
  // landed, but mutated 100ms ago (< quietMs) and far from the cap → keep waiting.
  expect(renderSettled(start + 2000, start + 1900, start, landedAt)).toBe(false)
})

test('quiet is measured from the LATER of last mutation and landedAt (idle lands before an imminent swap)', () => {
  const start = 1000
  // network idled at +500 while the placeholder was quiet, but the real swap mutates at +700. At +900,
  // only 200ms has passed since the swap (< quietMs) — must NOT settle yet despite landing at +500.
  expect(renderSettled(start + 900, start + 700, start, start + 500)).toBe(false)
  // by +1100 the DOM has been quiet for quietMs since the +700 swap → settle on the real content.
  expect(renderSettled(start + 1100, start + 700, start, start + 500)).toBe(true)
})

test('hard cap forces a settle on a never-quiet app (e.g. a DOM-mutating spinner), even if not landed', () => {
  const start = 1000
  // mutating every tick (last == now, never quiet), never landed (landedAt 0), but the cap is reached.
  const now = start + SETTLE_CAP_MS
  expect(renderSettled(now, now, start, 0)).toBe(true)
})

test('custom thresholds are honored', () => {
  expect(renderSettled(500, 400, 0, 100, 50, 10_000)).toBe(true) // landed@100, quiet 100ms >= 50
  expect(renderSettled(500, 480, 0, 100, 50, 10_000)).toBe(false) // quiet 20ms < 50, cap not hit
})

test('resolveSettle(undefined) yields exactly the defaults', () => {
  // a target with no per-target settle must be unchanged — backward-compatible.
  expect(resolveSettle()).toEqual({
    quietMs: SETTLE_QUIET_MS,
    capMs: SETTLE_CAP_MS,
    networkidleMs: SETTLE_NETWORKIDLE_MS,
  })
})

test('a partial settle override merges over the defaults (only the given key changes)', () => {
  // e.g. a websocket-heavy app: longer cap, the rest stays default.
  expect(resolveSettle({ capMs: 20_000 })).toEqual({
    quietMs: SETTLE_QUIET_MS,
    capMs: 20_000,
    networkidleMs: SETTLE_NETWORKIDLE_MS,
  })
})

test('out-of-bound settle values clamp to the min/max', () => {
  // below-min clamps up to the floor, above-max clamps down to the ceiling.
  expect(resolveSettle({ quietMs: 1, capMs: 999_999, networkidleMs: -5 })).toEqual({
    quietMs: 100,
    capMs: 30_000,
    networkidleMs: 0,
  })
  expect(resolveSettle({ quietMs: 99_999, capMs: 1, networkidleMs: 99_999 })).toEqual({
    quietMs: 5_000,
    capMs: 1_000,
    networkidleMs: 20_000,
  })
})
