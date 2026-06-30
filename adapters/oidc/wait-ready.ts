/**
 * Host-poll readiness for the OIDC stack. oauth2-proxy and whoami are distroless (no shell/wget), so
 * an in-container healthcheck isn't possible for them — we poll from the HOST instead (the Vikunja
 * lesson). Ready = Dex serves its OIDC discovery AND oauth2-proxy answers /ping. cannot-run = RED:
 * exits non-zero if the stack never comes up within the budget.
 */
const DEX_DISCOVERY = 'http://localhost:5556/dex/.well-known/openid-configuration'
const PROXY_PING = 'http://localhost:4180/ping'
const DEADLINE_MS = 120_000
const STEP_MS = 1_500

async function ok(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const start = Date.now()
  for (;;) {
    if ((await ok(DEX_DISCOVERY)) && (await ok(PROXY_PING))) {
      console.log('oidc ready (dex discovery + oauth2-proxy /ping -> 200)')
      return
    }
    if (Date.now() - start > DEADLINE_MS) {
      console.error(`oidc NOT ready after ${DEADLINE_MS}ms (dex ${DEX_DISCOVERY} / proxy ${PROXY_PING})`)
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, STEP_MS))
  }
}

main()
