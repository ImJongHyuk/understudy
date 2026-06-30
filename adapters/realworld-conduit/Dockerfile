# syntax=docker/dockerfile:1
#
# Hermetic Conduit (RealWorld) full-stack for understudy's reference suite.
# Base = latest active Node LTS (Debian variant: glibc + git + build tools, so the
# native `bcrypt` dependency installs reliably without extra apt steps).
#
# Nothing is vendored into understudy — the reference app is fetched at build time,
# PINNED to an exact upstream commit for reproducible, supply-chain-stable builds (a
# SHA can't be passed to `git clone --branch`, so we fetch the commit directly). To
# move the pin, update REALWORLD_REF to a newer commit of the upstream repo.
FROM node:lts

WORKDIR /app

ARG REALWORLD_REPO=https://github.com/TonyMckes/conduit-realworld-example-app
# conduit-realworld-example-app @ main, 2026-06-19 (verified via git ls-remote HEAD).
ARG REALWORLD_REF=5e127d8569b300e0a21dc2c20ea680da4967b1aa

# Shallow-fetch the exact pinned commit (React/Vite + Express + Sequelize) and install
# (npm respects the upstream lockfile; base images track latest LTS/stable).
RUN git init -q . \
 && git remote add origin "$REALWORLD_REPO" \
 && git fetch -q --depth 1 origin "$REALWORLD_REF" \
 && git checkout -q FETCH_HEAD \
 && npm install

EXPOSE 3000 3001

# On start (DB already healthy via compose depends_on): migrate, then run the
# backend (:3001) + the Vite frontend bound to 0.0.0.0:3000, which proxies
# /api -> :3001. `concurrently` is an upstream root devDependency.
CMD ["sh", "-c", "npx -w backend sequelize-cli db:migrate && npx concurrently \"npm run dev -w backend\" \"npm run dev -w frontend -- --host 0.0.0.0\""]
