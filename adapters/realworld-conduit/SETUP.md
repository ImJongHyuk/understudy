<!--
  ⚠️ TEMPORARY / DRAFT — hermetic bring-up for the RealWorld reference consumer ⚠️
-->

# SETUP — RealWorld (Conduit) reference consumer (hermetic, credential-free)

understudy's **second consumer** + canonical self-test: a real third-party SUT
(Conduit) running entirely **locally**, with a **different auth mechanism** than a
cookie/BFF consumer (here a JWT in `localStorage`) and **NO secrets / NO external
infra**. Anyone can reproduce it.

## Prereqs

- Docker + Docker Compose, and Node/Bun. Verified 2026-06-17: docker 27.1.1, compose
  v2.32.1, node v22, bun 1.3.14.

## One-command bring-up (docker compose) — PREFERRED

```bash
bun run realworld:up        # build + db + app, waits until healthy (frontend :3000, API :3001)
bun run e2e:realworld       # the reference suite (verified green via this path)
bun run realworld:down      # tear down (DB is disposable; no volume → pristine each up)
```

`docker-compose.yml` brings up `db` (postgres:17-alpine) + `app` (built from
`Dockerfile`: clones the Conduit reference at build time, migrates, runs the
backend + Vite). Base images track latest stable; the app's own deps are upstream-
pinned (TonyMckes). No secrets — the JWT key + DB password are throwaway local
values. Each `up` is a pristine, hermetic database.

## Alternative: manual bring-up (no Docker for the app)

```bash
git clone --depth 1 https://github.com/TonyMckes/conduit-realworld-example-app ~/jh/.refapps/conduit
cd ~/jh/.refapps/conduit && npm install
# Postgres on any FREE host port (5432/5433 may be taken):
docker run -d --name conduit-pg -p 55433:5432 \
  -e POSTGRES_USER=conduit -e POSTGRES_PASSWORD=conduit -e POSTGRES_DB=conduit_dev postgres:17-alpine
# backend/.env: PORT=3001, JWT_KEY=dev-only-not-a-secret, DEV_DB_{USERNAME,PASSWORD,
#   NAME}=conduit*, DEV_DB_HOSTNAME=127.0.0.1, DEV_DB_PORT=55433, DEV_DB_DIALECT=postgres
#   (and add `port: process.env.DEV_DB_PORT,` to backend/config/config.js development)
( set -a; . ./backend/.env; set +a; npx -w backend sequelize-cli db:migrate )
npm run dev   # frontend :3000 proxies /api → backend :3001
```

## Suite commands (in repos/understudy, against either bring-up)

```bash
bun run e2e:realworld              # setup (real login → storageState) + the journey
bunx playwright test --config playwright.realworld.config.ts --repeat-each=5   # burn-in
```

Defaults: `E2E_BASE_URL=http://localhost:3000`, `REALWORLD_API_BASE=http://localhost:3001`
(override if you used different ports).

## What it proves (credential-free)

- Real UI login → `storageState` (the JWT lives in `localStorage`, carried natively
  — no extra-state) → reuse, probe-refreshed.
- Real API seed (`POST /api/articles`) + teardown by the fixture prefix
  (`understudy-e2e-`); verified **0 orphans** after the run.
- **no-mock-of-SUT**: the spec hits the real Express/Sequelize/Postgres chain.
- The SAME core (`ensureAuth`, `SeedSession`, B10 host guard) as the first consumer
  — only the adapter differs. Burn-in ×5 clean.

## App specifics (for the adapter)

- **HASH routing** (`#/login`, `#/article/:slug`) — adapter navigates `/#/login`.
- Auth header is `Authorization: Token <jwt>` (RealWorld scheme, not Bearer).
- `localStorage` key = `loggedUser` (JSON incl. token).
- The feed toggle is a **button** ("Global Feed"); "New Article" nav link is
  authed-only (the assertAuthenticated probe).

## Teardown

```bash
bun run realworld:down      # compose path (down -v)
# manual path: docker rm -f conduit-pg
```

## Follow-on

- The `Dockerfile` clones upstream `main` for "latest" — pin a commit SHA (replace
  `--depth 1` with `--branch <sha>`) if you need byte-for-byte reproducibility.
