/**
 * RealWorld (Conduit) state-seed adapter — pressure-tests the generic SeedAdapter
 * against a backend with NO server-side allow-list / NO vault (one of the
 * INTERFACES-v0 "intentionally NOT frozen" open questions). Here `assertSafeTarget`
 * is a LOCAL-host check (the app is hermetic), and machine auth is self-bootstrapped:
 * register-or-login the fixed user via the public API to get a JWT, then send it as
 * `Authorization: Token <jwt>` (RealWorld's scheme — not Bearer). No secrets.
 */
import { apiRequest, type APIRequestContext } from '../../core/state-seed'
import type { SeedAdapter, SeedResource, SeedSession } from '../../core/state-seed'
import type { APIResponse } from '@playwright/test'
import { TEST_USER } from './auth.adapter'

const API_BASE = process.env.REALWORLD_API_BASE ?? 'http://localhost:3001'
const FIXTURE_PREFIX = 'understudy-e2e-'

async function tokenFrom(res: APIResponse): Promise<string | null> {
  if (!res.ok()) return null
  try {
    const body = (await res.json()) as { user?: { token?: string } }
    return body?.user?.token ?? null
  } catch {
    return null
  }
}

export const realworldSeedAdapter: SeedAdapter = {
  id: 'realworld-conduit',
  fixturePrefix: FIXTURE_PREFIX,

  // No vault here — the safety gate is "must be a LOCAL hermetic target".
  assertSafeTarget() {
    const host = new URL(API_BASE).hostname
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
      throw new Error(
        `Unsafe seed target "${host}" — the RealWorld reference seed runs only ` +
          `against a LOCAL hermetic app. Failing loud (cannot-run = RED).`,
      )
    }
  },

  // Machine auth = self-bootstrapped token (register-or-login the fixed user).
  async newRequestContext(): Promise<APIRequestContext> {
    const anon = await apiRequest.newContext({ baseURL: API_BASE })
    try {
      let token = await tokenFrom(
        await anon.post('/api/users', {
          data: {
            user: {
              username: TEST_USER.username,
              email: TEST_USER.email,
              password: TEST_USER.password,
            },
          },
        }),
      )
      if (!token) {
        token = await tokenFrom(
          await anon.post('/api/users/login', {
            data: { user: { email: TEST_USER.email, password: TEST_USER.password } },
          }),
        )
      }
      if (!token) {
        throw new Error('RealWorld seed could not obtain a token (register + login both failed)')
      }
      return apiRequest.newContext({
        baseURL: API_BASE,
        extraHTTPHeaders: { Authorization: `Token ${token}` },
      })
    } finally {
      await anon.dispose()
    }
  },
}

export interface ArticleSpec {
  readonly description?: string
  readonly body?: string
  readonly tagList?: readonly string[]
}

/** Create an article (`POST /api/articles`), tracked for teardown by slug. */
export async function seedArticle(
  session: SeedSession,
  spec: ArticleSpec = {},
): Promise<SeedResource> {
  const title = session.name('article') // fixture-prefixed → slug is too
  const res = await session.request.post('/api/articles', {
    data: {
      article: {
        title,
        description: spec.description ?? 'hermetic seed',
        body: spec.body ?? 'created by understudy seed',
        tagList: spec.tagList ?? ['e2e'],
      },
    },
  })
  if (!res.ok()) throw new Error(`create article ${res.status()}: ${await res.text()}`)
  const body = (await res.json()) as { article?: { slug?: string } }
  const slug = body?.article?.slug
  if (typeof slug !== 'string') throw new Error('RealWorld create returned no slug')
  return session.track({ kind: 'article', id: slug, name: title }, async (request, id) => {
    const r = await request.delete(`/api/articles/${id}`)
    if (!r.ok() && r.status() !== 404) throw new Error(`delete article ${r.status()}`)
  })
}
