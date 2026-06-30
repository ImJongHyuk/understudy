/**
 * Adapter manifest (C5) for the hermetic Cookie-Notes reference consumer. Note
 * what is ABSENT vs an allow-listed backend: there is no server-side allow-list,
 * so the safety gate is host-locality (assertSafeTarget = localhost) — the contract
 * bends cleanly to a backend without that allow-list discipline. Equally ABSENT:
 * any extra-state — the auth mechanism is an httpOnly cookie that storageState
 * carries natively. No secrets here.
 */
import { cookieAuthAdapter } from './auth.adapter'
import { cookieSeedAdapter } from './seed.adapter'

export const cookieAdapterConfig = {
  id: 'cookie-notes',
  auth: cookieAuthAdapter,
  seed: cookieSeedAdapter,
  // B10 host allow-list — the local hermetic app only.
  hostAllowlist: ['localhost:3100', '127.0.0.1:3100'] as const,
  fixturePrefix: 'understudy-e2e-',
  // a11y + raw HTTP floor; no contract enrichment.
  enrichment: { openapi: false },
} as const

export type CookieAdapterConfig = typeof cookieAdapterConfig
