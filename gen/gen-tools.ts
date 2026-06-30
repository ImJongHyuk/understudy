/**
 * gen/gen-tools — the TOOL surface for understudy's own GENERATION loop (`gen/gen-loop.ts`), the
 * generation analogue of `heal/real-tools.ts`. Three tools, all backed by real Playwright (NO LLM):
 *   - get_accessibility — live-ground: aria snapshot of the running app at a path.
 *   - write_spec        — write the candidate spec to the target path.
 *   - run_test          — run it through the deterministic gate (Playwright + a non-vacuous check).
 * Model-agnostic: the loop drives these via the `llm/` bridge, so understudy generates with ANY model,
 * on its OWN runtime — Claude Code is not required.
 */
import { type Browser } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'

export interface GenTarget {
  /** App base URL the browser grounds against (e.g. http://localhost:4173). */
  readonly origin: string
  /** Playwright storageState the grounding context loads (authenticated session). */
  readonly storageStatePath: string
  /** Absolute path the spec is written to and run from (inside the adapter's specs dir). */
  readonly outPath: string
  /** Playwright config (relative to repo root) used to run the spec — the deterministic gate. */
  readonly configPath: string
}

export interface RunResult {
  /** Playwright reported the run as green. */
  readonly passed: boolean
  /** The spec passed but is VACUOUS (does not exercise the behaviour) — not a real pass. */
  readonly vacuous: boolean
  readonly output: string
}

export interface GenTools {
  get_accessibility(path: string): Promise<string>
  write_spec(content: string): Promise<{ ok: boolean; error?: string }>
  run_test(): Promise<RunResult>
  getContent(): string
}

/**
 * A non-vacuous / assertion-strength check — a lightweight slice of the gate's negative-control
 * (`core/negative-control.ts`): a passing spec is trustworthy only if it ACTS on the app (click/fill/…)
 * AND asserts on real app/API state (not a constant). Cheap models GAME a naive "does it pass" oracle
 * by writing trivially-passing specs (`expect(true)`, a no-op goto+console.log), so the gate rejects
 * those. NOT a full behavioural negative-control (that needs a regressed build) — but it catches the
 * observed gaming. (See docs/CONTRACT-LESSONS.md L25.)
 */
export function isVacuous(src: string): boolean {
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const hasInteraction = /\.(click|fill|check|uncheck|press|selectOption|setChecked|dblclick)\s*\(/.test(code)
  const hasRealExpect =
    /expect\(\s*page[.\s]/.test(code) ||
    /expect\(\s*await\s/.test(code) ||
    /expect\(\s*[a-zA-Z_$][\w$.[\]'"]*\s*[),]/.test(code)
  const onlyConstantExpect = /expect\(/.test(code) && !/expect\(\s*(page|await|[a-zA-Z_$])/.test(code)
  return !hasInteraction || !hasRealExpect || onlyConstantExpect
}

/** Run one spec file through Playwright; pass/fail + a bounded error tail. */
function runSpec(configPath: string, outPath: string): { passed: boolean; output: string } {
  try {
    const out = execFileSync(
      'bunx',
      ['playwright', 'test', '--config', configPath, outPath, '--reporter=line'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 },
    )
    return { passed: /\d+ passed/.test(out) && !/\d+ failed/.test(out), output: out.slice(-1500) }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    const out = (err.stdout ?? '') + (err.stderr ?? '') || (err.message ?? 'run failed')
    return { passed: false, output: out.slice(-1500) }
  }
}

/** Build the gen tools bound to a target + a (shared, reused) browser. Contexts are per-call. */
export function makeGenTools(target: GenTarget, browser: Browser): GenTools {
  let content = ''
  return {
    async get_accessibility(p: string): Promise<string> {
      const ctx = await browser.newContext({ storageState: target.storageStatePath, baseURL: target.origin })
      try {
        const page = await ctx.newPage()
        page.setDefaultTimeout(15_000)
        await page.goto(p || '/')
        await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {})
        await page.waitForTimeout(600)
        const snap = await page.locator('body').ariaSnapshot()
        return snap.length > 6_000 ? snap.slice(0, 6_000) + '\n…[truncated]' : snap
      } finally {
        await ctx.close().catch(() => {})
      }
    },
    async write_spec(c: string) {
      try {
        content = c
        fs.writeFileSync(target.outPath, c, 'utf-8')
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    async run_test(): Promise<RunResult> {
      const r = runSpec(target.configPath, target.outPath)
      const vacuous = r.passed && isVacuous(content)
      return { passed: r.passed, vacuous, output: r.output }
    },
    getContent: () => content,
  }
}
