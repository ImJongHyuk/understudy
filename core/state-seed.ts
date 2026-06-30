/**
 * Generic state-seed engine — PROJECT-AGNOSTIC. Companion to core/auth-prefill.ts.
 *
 * Seeds a backend "branch start-state" via a project's API (MACHINE auth — not a
 * user login), tracks every created resource, and tears it down with a
 * NON-FIXTURE deletion guard (never deletes anything this run did not create).
 * Confines writes to the adapter's safe/allow-listed target: cannot-run = THROW,
 * never a silent skip (INV-6).
 *
 * Reuse boundary: a new project implements one `SeedAdapter` + a few create
 * helpers that use `SeedSession`. This file never changes.
 *
 * DRAFT (pre-scaffold). Drop into understudy/core/ at plan task T0.4.
 */
import {
  test as base,
  expect,
  request as apiRequest,
  type APIRequestContext,
} from '@playwright/test'
import { randomUUID } from 'node:crypto'

export interface SeedResource {
  readonly kind: string
  readonly id: string
  readonly name: string
}

type DeleteFn = (request: APIRequestContext, id: string) => Promise<void>

/** Per-run seeding handle: namespacing + a teardown registry with a safety guard. */
export class SeedSession {
  /** `${fixturePrefix}${runId}-` — a per-run unique namespace (concurrency-safe naming). */
  readonly runPrefix: string
  private readonly tracked: Array<{ res: SeedResource; del: DeleteFn }> = []

  constructor(
    readonly request: APIRequestContext,
    readonly fixturePrefix: string,
    runId: string,
  ) {
    this.runPrefix = `${fixturePrefix}${runId}-`
  }

  /** A unique, fixture-prefixed resource name for this run. */
  name(label: string): string {
    return `${this.runPrefix}${label}`
  }

  /**
   * Register a created resource for teardown. REFUSES anything whose name does
   * not carry the fixture prefix — the non-fixture deletion guard (safety; mirrors
   * a server-side teardown discipline where one exists).
   */
  track(res: SeedResource, del: DeleteFn): SeedResource {
    if (!res.name.startsWith(this.fixturePrefix)) {
      throw new Error(
        `Refusing to track non-fixture resource "${res.name}" (must start with "${this.fixturePrefix}")`,
      )
    }
    this.tracked.push({ res, del })
    return res
  }

  /** Best-effort reverse-order teardown. Re-throws on any failure (potential leak = loud). */
  async cleanup(): Promise<void> {
    const failures: string[] = []
    for (const { res, del } of [...this.tracked].reverse()) {
      if (!res.name.startsWith(this.fixturePrefix)) continue // defense in depth
      try {
        await del(this.request, res.id)
      } catch (e) {
        failures.push(`${res.kind}:${res.id} (${e instanceof Error ? e.message : String(e)})`)
      }
    }
    this.tracked.length = 0
    if (failures.length) {
      throw new Error(`Seed teardown failed (potential leaks): ${failures.join(', ')}`)
    }
  }
}

/** What a project supplies to seed against its backend. */
export interface SeedAdapter {
  readonly id: string
  /** Only resources whose name starts with this prefix may be created/torn down. */
  readonly fixturePrefix: string
  /** Build an APIRequestContext with MACHINE auth (API key / service token). */
  newRequestContext(): Promise<APIRequestContext>
  /** Safety gate: confirm the target is the isolated/allow-listed env. Throw → cannot-run RED. */
  assertSafeTarget(): void
  /** Optional preflight (L3): names of required-but-missing env/config. */
  preflight?(): string[]
}

/** Open a session: assert safe target (throws on unsafe), build the authed request context. */
export async function openSeedSession(adapter: SeedAdapter): Promise<SeedSession> {
  adapter.assertSafeTarget() // cannot-run = throw, never silent-skip (INV-6)
  const request = await adapter.newRequestContext()
  return new SeedSession(request, adapter.fixturePrefix, randomUUID().slice(0, 12))
}

/** Standalone seeded test (when you do NOT also need the authed browser). */
export function makeSeededTest(adapter: SeedAdapter) {
  return base.extend<{ seed: SeedSession }>({
    seed: async ({}, use) => {
      const session = await openSeedSession(adapter)
      try {
        await use(session)
      } finally {
        await session.cleanup() // teardown ALWAYS, even on test failure
        await session.request.dispose()
      }
    },
  })
}

export { expect, apiRequest, type APIRequestContext }
