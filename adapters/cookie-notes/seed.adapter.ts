/**
 * Cookie-Notes state-seed adapter — pressure-tests the generic SeedAdapter against
 * COOKIE-based machine auth (vs the RealWorld consumer's bearer-token header). Here
 * `assertSafeTarget` is a LOCAL-host check (the app is hermetic), and machine auth
 * is self-bootstrapped: POST /api/login with the fixed throwaway user mints the
 * httpOnly `sid` cookie INTO the request context, which then carries it on every
 * subsequent /api/notes write — no Authorization header, no secrets.
 */
import { apiRequest, type APIRequestContext } from '../../core/state-seed'
import type { SeedAdapter, SeedResource, SeedSession } from '../../core/state-seed'
import { TEST_USER } from './auth.adapter'

const API_BASE = process.env.COOKIE_API_BASE ?? 'http://localhost:3100'
const FIXTURE_PREFIX = 'understudy-e2e-'

export const cookieSeedAdapter: SeedAdapter = {
  id: 'cookie-notes',
  fixturePrefix: FIXTURE_PREFIX,

  // No vault here — the safety gate is "must be a LOCAL hermetic target".
  assertSafeTarget() {
    const host = new URL(API_BASE).hostname
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
      throw new Error(
        `Unsafe seed target "${host}" — the Cookie-Notes reference seed runs only ` +
          `against a LOCAL hermetic app. Failing loud (cannot-run = RED).`,
      )
    }
  },

  // Machine auth = self-bootstrapped COOKIE. POST /api/login sets the httpOnly
  // `sid` on this request context; the context's cookie jar replays it thereafter.
  async newRequestContext(): Promise<APIRequestContext> {
    const ctx = await apiRequest.newContext({ baseURL: API_BASE })
    const res = await ctx.post('/api/login', {
      data: { username: TEST_USER.username, password: TEST_USER.password },
    })
    if (!res.ok()) {
      await ctx.dispose()
      throw new Error(`Cookie-Notes seed could not log in (${res.status()}: ${await res.text()})`)
    }
    return ctx
  },
}

export interface NoteSpec {
  readonly body?: string
}

/** Create a note (`POST /api/notes`), tracked for teardown by id. */
export async function seedNote(session: SeedSession, spec: NoteSpec = {}): Promise<SeedResource> {
  const title = session.name('note') // fixture-prefixed → recognizably ours
  const res = await session.request.post('/api/notes', {
    data: { title, body: spec.body ?? 'created by understudy seed' },
  })
  if (!res.ok()) throw new Error(`create note ${res.status()}: ${await res.text()}`)
  const body = (await res.json()) as { id?: number }
  const id = body?.id
  if (typeof id !== 'number') throw new Error('Cookie-Notes create returned no id')
  // The app has no DELETE endpoint, but the in-memory store is pristine per `up`,
  // so teardown is a no-op while still going through the NON-FIXTURE guard (track
  // refuses any non-fixture name) — keeping the safety discipline identical to a
  // backend that does delete.
  return session.track({ kind: 'note', id: String(id), name: title }, async () => {
    /* in-memory store is reset per stack `up`; nothing to delete remotely */
  })
}
