/**
 * heal/settle — render-settle policy for the grounding snapshot (`get_accessibility`).
 *
 * `networkidle` alone is fragile in BOTH directions, as the live load test (scripts/settle-loadtest.ts)
 * proves: a websocket / long-poll app NEVER goes idle (so a blocking networkidle wait costs its full
 * timeout on EVERY snapshot — measured ~6s of pure dead weight), yet networkidle can ALSO fire BEFORE a
 * timer-driven render swaps the `loading…` placeholder for content (measured: idle at +500ms, swap at
 * +700ms). The robust settle is therefore EVENT-BASED and gated on TWO conditions:
 *   1. the render LANDED — EITHER the network idled (a fetch-driven render finished) OR a real DOM
 *      render wave was observed (a `loading…`→content swap fires mutations). The OR is what makes a
 *      never-idle app cheap: its keepalive traffic means networkidle never fires, but the content swap
 *      IS a mutation, so the render-wave clause carries it — no full networkidle timeout paid.
 *   2. the DOM has since been QUIET for `quietMs`, measured from the LATER of the last mutation and the
 *      landed moment — so a networkidle that fires while the placeholder is momentarily quiet does NOT
 *      settle us before an imminent swap (the swap's mutation pushes the quiet window forward).
 * A hard `capMs` always forces a snapshot (a never-quiet DOM-mutating spinner, or a never-idle app that
 * never visibly renders). DOM-quiet, not networkidle, is the PRIMARY signal; networkidle is a bounded,
 * opportunistic hint that can never dominate or hang.
 *
 * `renderSettled` is the PURE decision the in-page poller applies (conformance-tested); the
 * browser-side MutationObserver/networkidle wait only feed it `lastMutationAt` / `landedAt`.
 */
export const SETTLE_QUIET_MS = 400
export const SETTLE_CAP_MS = 9_000
export const SETTLE_NETWORKIDLE_MS = 6_000

/** Resolve the render-settle once BOTH (a) the render has LANDED — `landedAt > 0`, set when the
 * network idled OR the first DOM render wave was observed — AND (b) the DOM has been QUIET for
 * `quietMs`, measured from the LATER of `lastMutationAt` and `landedAt` (so a network-idle that lands
 * on a momentarily-quiet placeholder still waits out an imminent swap); OR the hard cap `capMs` since
 * `startedAt` is reached (a never-quiet app — e.g. a DOM-mutating spinner/clock, or a never-idle app
 * that never renders — must still snapshot). `landedAt = 0` means "not landed yet". All times are
 * epoch ms. */
export function renderSettled(
  now: number,
  lastMutationAt: number,
  startedAt: number,
  landedAt: number,
  quietMs: number = SETTLE_QUIET_MS,
  capMs: number = SETTLE_CAP_MS,
): boolean {
  const landed = landedAt > 0
  const quietFrom = Math.max(lastMutationAt, landedAt)
  return (landed && now - quietFrom >= quietMs) || now - startedAt >= capMs
}

/** The per-target settle budget. Different apps need different budgets — e.g. a websocket-heavy app
 * wants a longer hard cap and a shorter (or zero) networkidle wait since it never goes idle. */
export interface SettleConfig {
  quietMs: number
  capMs: number
  networkidleMs: number
}

const SETTLE_BOUNDS = {
  quietMs: [100, 5_000],
  capMs: [1_000, 30_000],
  networkidleMs: [0, 20_000],
} as const

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(Math.max(v, lo), hi)

/** Merge a partial settle budget over the defaults and clamp each field to sane bounds (quietMs
 * 100–5000, capMs 1000–30000, networkidleMs 0–20000). `undefined` → exactly today's defaults, so a
 * target with no `settle` is unchanged. */
export function resolveSettle(s?: Partial<SettleConfig>): SettleConfig {
  return {
    quietMs: clamp(s?.quietMs ?? SETTLE_QUIET_MS, SETTLE_BOUNDS.quietMs),
    capMs: clamp(s?.capMs ?? SETTLE_CAP_MS, SETTLE_BOUNDS.capMs),
    networkidleMs: clamp(s?.networkidleMs ?? SETTLE_NETWORKIDLE_MS, SETTLE_BOUNDS.networkidleMs),
  }
}
