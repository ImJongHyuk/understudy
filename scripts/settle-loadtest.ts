/**
 * settle load/verification — EMPIRICALLY verify the REAL settle path (`settleRender` from
 * heal/real-tools.ts) on a never-network-idle page. settle.ts only had its PURE decision
 * (`renderSettled`) conformance-tested; this closes the empirical gap the team flagged: on a real
 * SSE/long-poll page, does settleRender (a) avoid hanging, (b) still yield a RENDERED snapshot (not a
 * "loading…" placeholder), and (c) what LATENCY does the bounded networkidle wait cost per snapshot?
 *
 * It drives chromium DIRECTLY (chromium.launch(), NOT playwright-test) so it shares no test-results/
 * dir with the playwright-test suites and is safe to run alongside them. It imports the SAME
 * settleRender the product calls, so the numbers are the real code path — not a re-implementation.
 *
 * Run: `bun scripts/settle-loadtest.ts`
 */
import { chromium, type Browser } from '@playwright/test'
import { settleRender } from '../heal/real-tools'
import { resolveSettle, type SettleConfig } from '../heal/settle'
import { startLongpollServer } from './fixtures/longpoll-server'

const ITERATIONS = 5

interface Row {
  variant: string
  iter: number
  ms: number
  rendered: boolean // snapshot has the real button name
  placeholder: boolean // snapshot still shows "loading…"
  hung: boolean // settleRender exceeded its own hard bound
}

/** One snapshot via the REAL settle path; measures wall-clock + asserts rendered/not-placeholder. */
async function measureOnce(
  browser: Browser,
  url: string,
  settle: SettleConfig,
  hangBudgetMs: number,
): Promise<{ ms: number; rendered: boolean; placeholder: boolean; hung: boolean }> {
  const ctx = await browser.newContext()
  try {
    const page = await ctx.newPage()
    await page.goto(url)
    const t0 = Date.now()
    await settleRender(page, settle)
    const ms = Date.now() - t0
    const snap = await page.locator('body').ariaSnapshot()
    return {
      ms,
      rendered: /Create item/i.test(snap),
      placeholder: /loading/i.test(snap),
      // settleRender is internally bounded by capMs+2000 + the networkidle timeout; anything well past
      // that means it failed to honor its own bound (a hang).
      hung: ms > hangBudgetMs,
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

function printTable(rows: Row[]): void {
  console.log('\nvariant   iter   latency(ms)   rendered   placeholder   hung   verdict')
  console.log('-------   ----   -----------   --------   -----------   ----   -------')
  for (const r of rows) {
    const pass = r.rendered && !r.placeholder && !r.hung
    console.log(
      `${r.variant.padEnd(7)}   ${String(r.iter).padEnd(4)}   ${String(r.ms).padStart(11)}   ` +
        `${String(r.rendered).padEnd(8)}   ${String(r.placeholder).padEnd(11)}   ${String(r.hung).padEnd(4)}   ` +
        `${pass ? 'PASS' : 'FAIL'}`,
    )
  }
  const byVariant = new Map<string, number[]>()
  for (const r of rows) (byVariant.get(r.variant) ?? byVariant.set(r.variant, []).get(r.variant)!).push(r.ms)
  console.log('')
  for (const [variant, msList] of byVariant) {
    const sorted = [...msList].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    console.log(`${variant}: median ${median}ms  (min ${min}  max ${max})`)
  }
}

async function main(): Promise<void> {
  const server = await startLongpollServer()
  const browser = await chromium.launch()
  try {
    const settle = resolveSettle() // exactly the product defaults — this is what real heals use.
    console.log(
      `settle config: quietMs=${settle.quietMs} capMs=${settle.capMs} networkidleMs=${settle.networkidleMs}`,
    )
    console.log(`fixture: ${server.url}  (SSE keepalive ⇒ network NEVER idles; loading→content swap ~700ms)`)

    const rows: Row[] = []
    const hangBudget = settle.capMs + settle.networkidleMs + 4_000
    // static variant — content in the initial HTML (SSR/static): backward-compat baseline, must not
    // fall through to the cap (networkidle is the only landed signal when there's no render wave).
    for (let i = 1; i <= ITERATIONS; i++) {
      const r = await measureOnce(browser, `${server.url}/?variant=static`, settle, hangBudget)
      rows.push({ variant: 'static', iter: i, ...r })
    }
    // idle variant — a NORMAL eventually-idle SPA: the backward-compat baseline (must stay fast).
    for (let i = 1; i <= ITERATIONS; i++) {
      const r = await measureOnce(browser, `${server.url}/?variant=idle`, settle, hangBudget)
      rows.push({ variant: 'idle', iter: i, ...r })
    }
    // swap variant — the never-idle grounding case: must settle on REAL content, not the placeholder.
    for (let i = 1; i <= ITERATIONS; i++) {
      const r = await measureOnce(browser, `${server.url}/`, settle, hangBudget)
      rows.push({ variant: 'swap', iter: i, ...r })
    }
    // spinner variant — never-quiet DOM: confirms the hard cap forces a snapshot (still rendered).
    for (let i = 1; i <= ITERATIONS; i++) {
      const r = await measureOnce(browser, `${server.url}/?variant=spinner`, settle, hangBudget)
      rows.push({ variant: 'spinner', iter: i, ...r })
    }

    printTable(rows)

    const allPass = rows.every((r) => r.rendered && !r.placeholder && !r.hung)
    console.log(`\nOVERALL: ${allPass ? 'PASS — rendered, no placeholder, no hang on a never-idle page' : 'FAIL'}`)
    process.exitCode = allPass ? 0 : 1
  } finally {
    await browser.close().catch(() => {})
    await server.close().catch(() => {})
  }
}

main()
