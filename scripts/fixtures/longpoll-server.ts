/**
 * Long-poll / SSE fixture — a CONTROLLED REPRODUCTION of the never-network-idle condition that
 * settle.ts's doc warns about ("a websocket / long-poll app NEVER goes idle"). It exists to VERIFY
 * the real settle path on a real browser, NOT as a benchmark to tune toward.
 *
 * The served page reproduces the realistic failure mode: after `domcontentloaded` it shows a
 * `loading…` placeholder, then ~700ms later swaps in REAL content (a heading + a named button) via a
 * client-side render — exactly the swap that a snapshot-too-early would miss. Meanwhile it holds an
 * SSE stream open, emitting a keepalive every ~1s, so the browser's network NEVER idles and
 * `waitForLoadState('networkidle')` can only ever time out.
 *
 * Variants (via `?variant=`):
 *   - `swap` (default): loading → real content once, then network stays open (never idle). The
 *     grounding case: the DOM-quiet poller must settle AFTER the swap, on real content.
 *   - `spinner`: like `swap`, but after the swap a spinner keeps MUTATING the DOM forever (a
 *     class/text toggle every 120ms). The DOM never goes quiet → exercises the hard `capMs` cap.
 *   - `idle`: a NORMAL eventually-idle SPA — loading → swap, but NO persistent connection, so the
 *     network idles right after the swap. The backward-compat baseline: settle must stay fast here.
 *   - `static`: real content is in the INITIAL HTML — no placeholder, no swap, no mutation, no
 *     persistent connection. The other backward-compat baseline: with no render wave to observe,
 *     networkidle is the ONLY landed signal, so settle must NOT fall through to the hard cap here.
 *
 * The `swap`/`spinner` variants connect an SSE keepalive (never-idle); `idle`/`static` do not.
 *
 * Plain Node `http` only — no docker, no playwright-test. Pick a port unlikely to collide with the
 * docker reference consumers (default 4317).
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type LongpollVariant = 'swap' | 'spinner' | 'idle' | 'static'

/** ~700ms: late enough that a snapshot taken at domcontentloaded sees only the placeholder. */
const SWAP_DELAY_MS = 700
/** SSE keepalive cadence — frequent enough that the network is provably never idle. */
const KEEPALIVE_MS = 1_000
/** Spinner DOM-mutation cadence (spinner variant only) — keeps the DOM perpetually un-quiet. */
const SPINNER_TICK_MS = 120

function page(variant: LongpollVariant): string {
  // `static`: real content in the INITIAL HTML — no placeholder, no script, no mutation, no SSE.
  if (variant === 'static') {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>longpoll fixture</title></head>
<body><main id="app"><h1>Dashboard</h1><button type="button">Create item</button></main></body>
</html>`
  }
  // The page connects an EventSource immediately (network never idles), shows a placeholder, then at
  // SWAP_DELAY_MS replaces it with real, accessible content. The spinner variant then keeps mutating.
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>longpoll fixture</title></head>
<body>
  <main id="app"><p id="status">loading…</p></main>
  <script>
    const VARIANT0 = ${JSON.stringify(variant)};
    // swap/spinner hold a persistent connection so the network NEVER idles; idle is a normal SPA.
    if (VARIANT0 !== 'idle') {
      const es = new EventSource('/sse');
      es.onmessage = () => {}; // keepalives — ignored, but they keep the connection (and network) busy.
    }

    const SWAP_DELAY_MS = ${SWAP_DELAY_MS};
    const SPINNER_TICK_MS = ${SPINNER_TICK_MS};
    const VARIANT = ${JSON.stringify(variant)};

    setTimeout(() => {
      // The async client render: swap the placeholder for the REAL view (heading + named button).
      const app = document.getElementById('app');
      app.innerHTML =
        '<h1>Dashboard</h1>' +
        '<button type="button">Create item</button>' +
        '<p id="live"></p>';
      if (VARIANT === 'spinner') {
        // A DOM-mutating spinner: never lets the DOM go quiet, so settle must fall back to capMs.
        const live = document.getElementById('live');
        let n = 0;
        setInterval(() => { live.textContent = 'working' + '.'.repeat((n++) % 4); }, SPINNER_TICK_MS);
      }
    }, SWAP_DELAY_MS);
  </script>
</body>
</html>`
}

/** Start the fixture server. Returns the chosen `port`, the base `url`, and a `close()` that also
 * tears down every still-open SSE connection (so the process can exit cleanly). */
export function startLongpollServer(port = 4317): Promise<{
  port: number
  url: string
  close: () => Promise<void>
}> {
  const open = new Set<http.ServerResponse>()
  const timers = new Set<ReturnType<typeof setInterval>>()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/sse') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 10000\n\n')
      open.add(res)
      // Keepalive comments keep the connection (and thus the browser's network) perpetually busy.
      const t = setInterval(() => res.write(`data: ${Date.now()}\n\n`), KEEPALIVE_MS)
      timers.add(t)
      req.on('close', () => {
        clearInterval(t)
        timers.delete(t)
        open.delete(res)
      })
      return
    }
    const v = url.searchParams.get('variant')
    const variant: LongpollVariant =
      v === 'spinner' ? 'spinner' : v === 'idle' ? 'idle' : v === 'static' ? 'static' : 'swap'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(page(variant))
  })

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = (server.address() as AddressInfo).port
      resolve({
        port: actual,
        url: `http://localhost:${actual}`,
        close: () =>
          new Promise<void>((done) => {
            for (const t of timers) clearInterval(t)
            for (const res of open) res.end()
            server.close(() => done())
          }),
      })
    })
  })
}

// Allow running standalone for manual inspection: `bun scripts/fixtures/longpoll-server.ts`.
if (import.meta.main) {
  startLongpollServer().then(({ url }) => {
    console.log(`longpoll fixture on ${url}  (swap: ${url}/  |  spinner: ${url}/?variant=spinner)`)
  })
}
