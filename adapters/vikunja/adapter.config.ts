/**
 * Adapter manifest (C5) for the hermetic Vikunja reference consumer — a RICHER surface than Conduit
 * on the SAME core. Like RealWorld: no server-side allow-list (safety = host-locality), no extra
 * state (JWT in localStorage carried by storageState), no contract enrichment. No secrets.
 */
import { vikunjaAuthAdapter } from './auth.adapter'
import { vikunjaSeedAdapter } from './seed.adapter'

export const vikunjaAdapterConfig = {
  id: 'vikunja',
  auth: vikunjaAuthAdapter,
  seed: vikunjaSeedAdapter,
  // B10 host allow-list — the local hermetic dev frontend (the browser SUT) only.
  hostAllowlist: ['localhost:4173', '127.0.0.1:4173'] as const,
  fixturePrefix: 'understudy-e2e-',
  // a11y + raw HTTP floor; no contract enrichment.
  enrichment: { openapi: false },
} as const

export type VikunjaAdapterConfig = typeof vikunjaAdapterConfig
