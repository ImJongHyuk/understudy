/**
 * Vikunja state-seed adapter — self-bootstrapped machine auth (register-or-login the fixed user via
 * the public API to get a JWT, sent as `Authorization: Bearer <jwt>`). Like the RealWorld consumer
 * there is NO server-side allow-list / NO vault, so `assertSafeTarget` is a LOCAL-host check (the app
 * is hermetic). No secrets.
 *
 * Seed helpers create a PROJECT and TASKS via the REST API and track them for reverse-order teardown.
 */
import { apiRequest, type APIRequestContext } from '../../core/state-seed'
import type { SeedAdapter, SeedResource, SeedSession } from '../../core/state-seed'
import type { APIResponse } from '@playwright/test'
import { TEST_USER } from './auth.adapter'

// The seed talks to the BACKEND API directly (:3456) — the browser SUT is the dev frontend (:4173).
const ORIGIN = process.env.VIKUNJA_API_URL ?? 'http://localhost:3456'
const API = '/api/v1'
const FIXTURE_PREFIX = 'understudy-e2e-'

async function tokenFrom(res: APIResponse): Promise<string | null> {
  if (!res.ok()) return null
  try {
    const body = (await res.json()) as { token?: string }
    return body?.token ?? null
  } catch {
    return null
  }
}

export const vikunjaSeedAdapter: SeedAdapter = {
  id: 'vikunja',
  fixturePrefix: FIXTURE_PREFIX,

  // No vault here — the safety gate is "must be a LOCAL hermetic target".
  assertSafeTarget() {
    const host = new URL(ORIGIN).hostname
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
      throw new Error(
        `Unsafe seed target "${host}" — the Vikunja reference seed runs only against a LOCAL ` +
          `hermetic app. Failing loud (cannot-run = RED).`,
      )
    }
  },

  // Machine auth = self-bootstrapped token (register-or-login the fixed user).
  async newRequestContext(): Promise<APIRequestContext> {
    const anon = await apiRequest.newContext({ baseURL: ORIGIN })
    try {
      // register-if-needed (an "already exists" is a resolved response, not a throw)
      await anon.post(`${API}/register`, {
        data: { username: TEST_USER.username, email: TEST_USER.email, password: TEST_USER.password },
      })
      const token = await tokenFrom(
        await anon.post(`${API}/login`, {
          data: { username: TEST_USER.username, password: TEST_USER.password },
        }),
      )
      if (!token) throw new Error('Vikunja seed could not obtain a token (register + login failed)')
      return apiRequest.newContext({
        baseURL: ORIGIN,
        extraHTTPHeaders: { Authorization: `Bearer ${token}` },
      })
    } finally {
      await anon.dispose()
    }
  },
}

/** Create a project (`PUT /api/v1/projects`), tracked for teardown by id. */
export async function seedProject(session: SeedSession): Promise<SeedResource> {
  const title = session.name('project')
  const res = await session.request.put(`${API}/projects`, { data: { title } })
  if (!res.ok()) throw new Error(`create project ${res.status()}: ${await res.text()}`)
  const id = String(((await res.json()) as { id?: number }).id ?? '')
  if (!id) throw new Error('Vikunja create project returned no id')
  return session.track({ kind: 'project', id, name: title }, async (request, pid) => {
    const r = await request.delete(`${API}/projects/${pid}`)
    if (!r.ok() && r.status() !== 404) throw new Error(`delete project ${r.status()}`)
  })
}

/** Create a task in a project (`PUT /api/v1/projects/:id/tasks`), tracked for teardown by id. */
export async function seedTask(session: SeedSession, projectId: string): Promise<SeedResource> {
  const title = session.name('task')
  const res = await session.request.put(`${API}/projects/${projectId}/tasks`, { data: { title } })
  if (!res.ok()) throw new Error(`create task ${res.status()}: ${await res.text()}`)
  const id = String(((await res.json()) as { id?: number }).id ?? '')
  if (!id) throw new Error('Vikunja create task returned no id')
  return session.track({ kind: 'task', id, name: title }, async (request, tid) => {
    const r = await request.delete(`${API}/tasks/${tid}`)
    if (!r.ok() && r.status() !== 404) throw new Error(`delete task ${r.status()}`)
  })
}
