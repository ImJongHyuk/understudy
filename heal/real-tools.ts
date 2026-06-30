/**
 * heal/real-tools — the REAL heal tool surface, driving a hermetic reference consumer via Playwright.
 * Shared by the measurement harness (scripts/a3-heal-measure.ts), the skill optimizer
 * (scripts/skill-optimize.ts), and the real-break demo (scripts/heal-real-break.ts) so all roll out
 * against the SAME real gate. Bounded throughout (execFileSync timeouts + withDeadline on browser
 * ops) and reuses ONE shared browser (per-call contexts) — re-launching+closing a browser every call
 * leaked chromiums until the host starved and runs stalled.
 *
 * ADAPTER-AGNOSTIC: all functions take a `HealTarget` (origin / storageState / temp-spec path /
 * playwright config). `heal/` imports NO adapter — the caller wires the adapter via `makeHealTarget`,
 * so the same heal path serves Conduit, Vikunja, or any future consumer.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { type Browser, type Page } from '@playwright/test'
import { authArtifacts, type AuthAdapter } from '../core/auth-prefill'
import { applyReplace } from './edit'
import { parseClicks, nameMatcher } from './probe'
import { resolveSettle, type SettleConfig } from './settle'
import { selectDisclosures, MAX_AUTO_DISCLOSURES, type Affordance } from './auto-probe'

/** The Healer tool surface (the loop/optimizer is agnostic to mock vs real). */
export interface HealTools {
  getSpec(): string
  run_test(): Promise<{ passed: boolean; output: string }>
  /** Snapshot the app at `path`. With `clicks` (accessible names of buttons/links), click each in
   * order AFTER navigating, THEN snapshot — so interaction-gated state (e.g. a list behind a tab)
   * can be grounded, not guessed. */
  get_accessibility(path: string, clicks?: readonly string[]): Promise<string>
  replace_in_spec(old: string, replacement: string): Promise<{ ok: boolean; error?: string }>
}

/** Everything the real heal gate needs about ONE reference consumer — supplied by the caller so
 * `heal/` stays consumer-free. Build it with `makeHealTarget`. */
export interface HealTarget {
  readonly origin: string
  readonly storageStatePath: string
  /** Where the per-rollout temp spec is written (the adapter's specs dir; gitignored). */
  readonly tempSpecPath: string
  readonly playwrightConfig: string
  /** Optional per-target render-settle budget (see `resolveSettle`). Omit → today's defaults; a
   * websocket-heavy app may want a longer `capMs` / shorter `networkidleMs`. */
  readonly settle?: Partial<SettleConfig>
}

/** Derive a HealTarget from an adapter's auth + its playwright config + specs dir. */
export function makeHealTarget(opts: {
  authAdapter: AuthAdapter
  playwrightConfig: string
  specsDir: string
  settle?: Partial<SettleConfig>
}): HealTarget {
  return {
    origin: opts.authAdapter.origin,
    storageStatePath: authArtifacts(opts.authAdapter).storageStatePath,
    tempSpecPath: path.join(opts.specsDir, '_a3_heal.spec.ts'),
    playwrightConfig: opts.playwrightConfig,
    settle: opts.settle,
  }
}

/** Bound a promise with a timeout so a wedged Playwright/browser op (newContext, snapshot, or even
 * context.close) can never hang the whole run. */
export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} exceeded ${ms}ms`)), ms)),
  ])
}

/** Wait for the page's async render to SETTLE before snapshotting — robust grounding. This is the live
 * application of the PURE `renderSettled` decision (see heal/settle.ts for the full rationale +
 * conformance): the render is settled once it has LANDED (the network idled OR a DOM render wave was
 * observed) AND the DOM has since been QUIET for `quietMs` (measured from the later of the last
 * mutation and the landed moment), OR the hard `capMs`. DOM-quiet is the PRIMARY signal; networkidle
 * runs CONCURRENTLY (bounded) and only flips a flag the in-page poller reads — it is never awaited on
 * its own, so a never-idle ws/long-poll app pays nothing for it and can't hang. Measured
 * (scripts/settle-loadtest.ts): keeps grounding correct (real content, not the `loading…` placeholder)
 * on idle / never-idle / static / spinner pages while cutting the never-idle per-snapshot cost from
 * networkidleMs+quietMs (~6.4s) to ~render-time+quietMs (~1.1s). The budget is per-target (see
 * `resolveSettle`). All-bounded + best-effort: it never throws, never hangs. */
export async function settleRender(page: Page, settle: SettleConfig): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  // Bounded networkidle, fired CONCURRENTLY with the DOM poller: when it resolves it records the
  // landed time on a page global the poller reads. Never awaited on its own → a never-idle app pays
  // nothing for it; it's purely an opportunistic "fetch finished" hint for apps that DO idle.
  page.evaluate(() => ((window as unknown as { __settleNetIdleAt?: number }).__settleNetIdleAt = 0)).catch(() => {})
  page
    .waitForLoadState('networkidle', { timeout: settle.networkidleMs })
    .then(() =>
      page
        .evaluate(() => {
          const w = window as unknown as { __settleNetIdleAt?: number }
          if (!w.__settleNetIdleAt) w.__settleNetIdleAt = Date.now()
        })
        .catch(() => {}),
    )
    .catch(() => {})
  await withDeadline(
    page.evaluate(
      ({ quietMs, capMs }) =>
        new Promise<void>((resolve) => {
          let last = Date.now()
          const start = last
          let waveAt = 0 // epoch ms of the FIRST DOM render wave (a loading→content swap), else 0
          const obs = new MutationObserver(() => {
            const n = Date.now()
            last = n
            if (!waveAt) waveAt = n
          })
          obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true })
          const tick = () => {
            const now = Date.now()
            const netAt = (window as unknown as { __settleNetIdleAt?: number }).__settleNetIdleAt ?? 0
            // "landed" = the EARLIER of (network idled) and (first render wave); 0 = not landed yet.
            const landedAt = waveAt && netAt ? Math.min(waveAt, netAt) : waveAt || netAt
            // mirrors heal/settle.ts renderSettled: landed AND DOM quiet for quietMs since the later of
            // the last mutation and the landed moment, OR the hard cap.
            const quietFrom = Math.max(last, landedAt)
            if ((landedAt > 0 && now - quietFrom >= quietMs) || now - start >= capMs) {
              obs.disconnect()
              resolve()
            } else {
              setTimeout(tick, 80)
            }
          }
          tick()
        }),
      { quietMs: settle.quietMs, capMs: settle.capMs },
    ),
    settle.capMs + 2_000,
    'settleRender',
  ).catch(() => {})
}

/** Per-revealed-section snapshot clip — keeps the enriched grounding snapshot bounded on a
 * control-dense page (each auto-opened disclosure contributes at most this many chars). */
const DISCLOSE_SECTION_CLIP = 1_500

/**
 * DETERMINISTIC grounding disclosure — the live application of heal/auto-probe. A weak model often
 * doesn't request the `clicks` needed to reach a tab/accordion/menu-gated control, so the harness
 * opens the SAFE disclosure affordances itself and appends a labelled sub-snapshot of each revealed
 * state. Bounded + best-effort throughout: opens at most `MAX_AUTO_DISCLOSURES`, NEVER a
 * destructive-named control (grounding hits the real backend — see auto-probe's safety note), uses a
 * light settle (no networkidle, short cap — the content is client-revealed), and on ANY failure
 * contributes nothing (the base snapshot is unchanged → never worse than today). Returns the revealed
 * sections (possibly empty).
 */
async function autoDisclose(page: Page, settle: SettleConfig): Promise<string[]> {
  // A light settle for revealed content: it's a client-side disclosure, so skip networkidle and cap
  // short — we only need the just-revealed nodes to paint, not a full fetch+render cycle.
  const discloseSettle: SettleConfig = {
    quietMs: Math.min(settle.quietMs, 250),
    capMs: Math.min(settle.capMs, 2_500),
    networkidleMs: 0,
  }
  // Open <details> additively (pure DOM, no backend) and scan candidate affordances, marking each with
  // a stable selector. RE-SCANNED every iteration: a prior disclosure click can re-render the DOM and
  // stale the old markers (observed live — only the first of several disclosures opened), so we re-mark
  // fresh elements each pass instead of trusting one scan.
  const scan = () =>
    page
      .evaluate(() => {
        document.querySelectorAll('details:not([open])').forEach((d) => ((d as HTMLDetailsElement).open = true))
        const els = Array.from(document.querySelectorAll('[role=tab], [aria-expanded], [aria-haspopup], summary, button'))
        return els.map((el, i) => {
          el.setAttribute('data-uprobe', String(i))
          const tag = el.tagName.toLowerCase()
          const role =
            el.getAttribute('role') || (tag === 'summary' ? 'summary' : tag === 'a' ? 'link' : tag === 'button' ? 'button' : '')
          const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 120)
          const ea = el.getAttribute('aria-expanded')
          return { idx: i, role, name, tag, expanded: ea === null ? null : ea === 'true', hasPopup: el.getAttribute('aria-haspopup') }
        })
      })
      .catch(() => [] as (Affordance & { idx: number })[])

  const sections: string[] = []
  const opened = new Set<string>() // role|name keys already opened — don't re-click the same control
  for (let k = 0; k < MAX_AUTO_DISCLOSURES; k++) {
    const candidates = await scan()
    // Pick the highest-value SAFE disclosure not yet opened (<details> are already open → skip summary).
    const pick = selectDisclosures(candidates).find((c) => c.tag !== 'summary' && !opened.has(`${c.role}|${c.name}`))
    if (!pick) break
    opened.add(`${pick.role}|${pick.name}`)
    try {
      await withDeadline(
        page.locator(`[data-uprobe="${pick.idx}"]`).first().click({ timeout: 4_000 }),
        6_000,
        `disclose "${pick.name}"`,
      )
      await settleRender(page, discloseSettle)
      const snap = await withDeadline(page.locator('body').ariaSnapshot(), 10_000, 'disclose-snap')
      const label = pick.name || pick.role || pick.tag || 'control'
      sections.push(`--- after opening ${pick.role || pick.tag} "${label}" (auto-probe) ---\n${snap.slice(0, DISCLOSE_SECTION_CLIP)}`)
    } catch {
      /* a control that wouldn't open is skipped — never a hang/crash */
    }
  }
  return sections
}

/** Run the consumer's setup project once (auth → storageState). Call before any real rollouts. */
export function ensureSetup(target: HealTarget): void {
  execFileSync('bunx', ['playwright', 'test', '--config', target.playwrightConfig, '--project=setup'], {
    stdio: 'ignore',
    timeout: 180_000,
    killSignal: 'SIGKILL',
  })
}

export function cleanupTemp(target: HealTarget): void {
  try {
    if (fs.existsSync(target.tempSpecPath)) fs.unlinkSync(target.tempSpecPath)
  } catch {
    /* best effort */
  }
}

/**
 * The TRACE LEVER (the highest-ROI heal-quality move). On failure Playwright writes an
 * `error-context.md` per failed test = the error + the **page's aria snapshot at the moment of
 * failure**. That snapshot is the runtime evidence that lets a model root-cause the UPSTREAM step
 * across flavors: e.g. a wrong "Your Feed" click leaves the page showing "Articles not available"
 * — visible in the snapshot — so the model can see its step put the page in the wrong state, rather
 * than only "timed out" (which points at the failing line and induces symptom-fixing). We just READ
 * the file (no trace parsing); the newest one after a run is this run's. */
function readNewestErrorContext(): string | null {
  const root = 'test-results'
  if (!fs.existsSync(root)) return null
  let newest: { path: string; mtime: number } | null = null
  for (const dir of fs.readdirSync(root)) {
    const p = path.join(root, dir, 'error-context.md')
    try {
      const st = fs.statSync(p)
      if (!newest || st.mtimeMs > newest.mtime) newest = { path: p, mtime: st.mtimeMs }
    } catch {
      /* no error-context in this dir */
    }
  }
  if (!newest) return null
  try {
    return fs.readFileSync(newest.path, 'utf-8')
  } catch {
    return null
  }
}

/** Run whatever is currently in the temp spec; a hung run becomes a bounded RED, never a stall. On
 * failure, return the page-state-at-failure (error-context.md) — the trace lever — not just stdout. */
function runTempSpec(target: HealTarget): { passed: boolean; output: string } {
  try {
    execFileSync('bunx', ['playwright', 'test', '--config', target.playwrightConfig, target.tempSpecPath], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 90_000,
      killSignal: 'SIGKILL',
    })
    return { passed: true, output: '1 passed' }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; killed?: boolean; signal?: string }
    if (err.killed || err.signal) {
      return { passed: false, output: `TIMEOUT: playwright run exceeded budget (${err.signal ?? 'killed'})` }
    }
    const ctx = readNewestErrorContext()
    if (ctx) {
      return {
        passed: false,
        output:
          'FAILED. Below is the error AND the page state at the moment of failure. The snapshot ' +
          'shows what your steps ACTUALLY produced — find the EARLIEST step whose result is wrong ' +
          '(it is often an upstream click/navigation, not the failing assertion line):\n\n' +
          ctx.slice(0, 4000),
      }
    }
    return { passed: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}`.slice(-1800) }
  }
}

/** Write a spec and run it once — used for the RED precheck (a break must fail before measuring). */
export function runSpecOnce(target: HealTarget, spec: string): { passed: boolean; output: string } {
  fs.writeFileSync(target.tempSpecPath, spec)
  return runTempSpec(target)
}

/** Real heal tools for one broken spec against `target`. `run_test` writes + runs the spec;
 * `get_accessibility` snapshots the live app via a context on the shared browser. */
export function makeRealTools(target: HealTarget, brokenSpec: string, browser: Browser): HealTools {
  let spec = brokenSpec
  return {
    getSpec: () => spec,
    async run_test() {
      fs.writeFileSync(target.tempSpecPath, spec)
      return runTempSpec(target)
    },
    async get_accessibility(p: string, clicks?: readonly string[]) {
      const settle = resolveSettle(target.settle)
      const ctx = await withDeadline(
        browser.newContext({ storageState: target.storageStatePath, baseURL: target.origin }),
        20_000,
        'newContext',
      )
      try {
        const page = await ctx.newPage()
        page.setDefaultTimeout(20_000)
        page.setDefaultNavigationTimeout(20_000)
        await page.goto(p || '/')
        // Wait for the async render to settle (see settleRender) before snapshotting — else a
        // client-rendered view is captured as a "loading…" placeholder and the model can't ground
        // the real controls.
        await settleRender(page, settle)
        // GROUNDING PROBE: click named affordances to reach interaction-gated state, then snapshot.
        // Each click is bounded + best-effort: a missing control is noted, never a hang/crash.
        const notes: string[] = []
        for (const name of parseClicks(clicks)) {
          const target = page
            .getByRole('button', { name: nameMatcher(name) })
            .or(page.getByRole('link', { name: nameMatcher(name) }))
            .first()
          try {
            await withDeadline(target.click({ timeout: 8_000 }), 10_000, `click "${name}"`)
            await settleRender(page, settle)
          } catch {
            notes.push(`(probe: could not click "${name}")`)
          }
        }
        const snap = await withDeadline(page.locator('body').ariaSnapshot(), 20_000, 'ariaSnapshot')
        const base = notes.length ? `${notes.join(' ')}\n${snap}` : snap
        // DETERMINISTIC auto-probe: surface SAFE interaction-gated controls (tabs/accordions/menus/
        // <details>) the model didn't think to request, as labelled sub-snapshots. Bounded +
        // best-effort → on failure it adds nothing (base snapshot unchanged).
        const revealed = await withDeadline(autoDisclose(page, settle), 35_000, 'autoDisclose').catch(
          () => [] as string[],
        )
        return revealed.length ? [base, ...revealed].join('\n\n') : base
      } finally {
        await withDeadline(ctx.close(), 5_000, 'context.close').catch(() => {})
      }
    },
    async replace_in_spec(old, replacement) {
      const r = applyReplace(spec, old, replacement)
      if (!r.ok) return { ok: false, error: r.error }
      spec = r.spec as string
      return { ok: true }
    },
  }
}
