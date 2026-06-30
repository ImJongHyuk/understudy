/**
 * Vikunja-profile globalSetup — wires the core B10 host guard with this consumer's allow-list (the
 * local hermetic app). A non-allow-listed host = cannot-run RED before any browser launches.
 */
import { assertHostAllowed } from '../../core/host-guard'
import { vikunjaAdapterConfig } from './adapter.config'

export default async function globalSetup(): Promise<void> {
  assertHostAllowed(vikunjaAdapterConfig.auth.origin, vikunjaAdapterConfig.hostAllowlist)
}
