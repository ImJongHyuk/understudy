/**
 * Adapter manifest for the hermetic OIDC reference consumer. Note what is ABSENT: there is no state
 * SEED adapter — the protected resource has no domain data to create; the CUF is "reach the protected
 * surface authenticated". The safety gate is host-locality (the local hermetic stack only). No secrets.
 */
import { oidcAuthAdapter } from './auth.adapter'

export const oidcAdapterConfig = {
  id: 'oidc',
  auth: oidcAuthAdapter,
  // B10 host allow-list — the local hermetic oauth2-proxy only.
  hostAllowlist: ['localhost:4180', '127.0.0.1:4180'] as const,
  // a11y + raw HTTP floor; no contract enrichment.
  enrichment: { openapi: false },
} as const

export type OidcAdapterConfig = typeof oidcAdapterConfig
