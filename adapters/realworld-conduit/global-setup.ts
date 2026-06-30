/**
 * RealWorld-profile globalSetup — wires the CORE B10 host guard with this
 * consumer's allow-list (the local hermetic app). A non-allow-listed host =
 * cannot-run RED before any browser launches. Adapter-owned so core stays
 * consumer-free.
 */
import { assertHostAllowed } from '../../core/host-guard'
import { realworldAdapterConfig } from './adapter.config'

export default async function globalSetup(): Promise<void> {
  assertHostAllowed(realworldAdapterConfig.auth.origin, realworldAdapterConfig.hostAllowlist)
}
