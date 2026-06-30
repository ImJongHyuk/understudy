/**
 * The `test` the OIDC specs import. Composes browser auth (the oauth2-proxy session cookie via
 * storageState) — identical CORE machinery as the other adapters. No `seed` fixture: the OIDC
 * reference has no domain data to create (the CUF is reaching the protected surface authenticated).
 */
import { makeAuthedTest, expect } from '../../core/auth-prefill'
import { oidcAuthAdapter } from './auth.adapter'

export const test = makeAuthedTest(oidcAuthAdapter)

export { expect }
