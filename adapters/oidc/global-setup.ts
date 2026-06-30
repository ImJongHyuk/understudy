/**
 * OIDC-profile globalSetup — wires the CORE B10 host guard with this consumer's allow-list (the local
 * hermetic stack). A non-allow-listed host = cannot-run RED before any browser launches. Adapter-owned
 * so core stays consumer-free.
 */
import { assertHostAllowed } from '../../core/host-guard'
import { oidcAdapterConfig } from './adapter.config'

export default async function globalSetup(): Promise<void> {
  assertHostAllowed(oidcAdapterConfig.auth.origin, oidcAdapterConfig.hostAllowlist)
}
