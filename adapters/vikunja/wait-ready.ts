/**
 * Host-side readiness poll for the Vikunja stack — the image is distroless (no shell), so an
 * in-container docker healthcheck isn't available. `bun run vikunja:up` runs this after
 * `docker compose up -d`, blocking until the API answers (or failing loud = cannot-run RED).
 */
export {} // make this a module (top-level await)

// Poll the dev SUT (:4173) via /api/v1/info — proves the Vite frontend serves AND proxies to a live
// backend. Override with VIKUNJA_READY_URL if needed.
const infoUrl = process.env.VIKUNJA_READY_URL ?? 'http://localhost:4173/api/v1/info'

for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(infoUrl)
    if (r.ok) {
      console.log(`vikunja ready (${infoUrl} -> 200)`)
      process.exit(0)
    }
  } catch {
    /* not up yet */
  }
  await new Promise((res) => setTimeout(res, 2000))
}
console.error(`vikunja did not become ready at ${infoUrl} after 120s`)
process.exit(1)
