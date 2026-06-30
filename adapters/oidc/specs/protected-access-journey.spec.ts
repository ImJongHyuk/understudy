/**
 * OIDC reference CUF — an authenticated user reaches an OAuth2/OIDC-protected resource. The session
 * was established ONCE via the real authorization-code redirect flow (setup project → the adapter's
 * login() drives RP→IdP→consent→callback) and restored from storageState (the oauth2-proxy cookie).
 * The protected upstream (whoami) is served only with a valid session and echoes the proxy-injected
 * identity, so asserting that identity proves a real authenticated round-trip — no token parsing.
 */
import { test, expect } from '../fixtures'
import { TEST_USER } from '../auth.adapter'

test.describe('oidc protected-access journey (reference CUF)', () => {
  test('an authenticated user reaches the OIDC-protected resource and sees their identity', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(TEST_USER.email)).toBeVisible()
    await expect(page.getByText('X-Forwarded-Email')).toBeVisible() // proxy-injected identity header
  })

  // NEGATIVE CONTROL (behaviour-level): break the real auth STATE → the test must go RED. Drop the
  // session cookie; the protected resource must then NOT be served — the relying party 302s to the IdP
  // login form, so the identity is absent. This proves the protection (and the positive assertion
  // above) is real, not a vacuous always-green check.
  test('NEGATIVE CONTROL: without a valid session the resource is not served (redirects to the IdP)', async ({
    page,
    context,
  }) => {
    await context.clearCookies()
    await page.goto('/')
    await expect(page.getByText(TEST_USER.email)).toHaveCount(0)
    await expect(page.getByPlaceholder('email address')).toBeVisible() // the IdP login form, not the app
  })
})
