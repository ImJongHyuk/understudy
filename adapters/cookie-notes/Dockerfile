# syntax=docker/dockerfile:1
#
# Hermetic Cookie-Notes app for understudy's reference suite — the THIRD consumer's
# System-Under-Test. Its auth mechanism is an httpOnly server SESSION COOKIE (opaque
# `sid`), distinct from the RealWorld consumer's localStorage JWT.
#
# Base = latest active Node LTS. Deps install at build time; nothing is vendored. No
# DB, no secrets — every run is pristine.
FROM node:lts

WORKDIR /app

# Install the app's runtime deps, PINNED to exact versions for reproducible builds.
ARG EXPRESS_VERSION=5.2.1
ARG EXPRESS_SESSION_VERSION=1.19.0
RUN npm install "express@${EXPRESS_VERSION}" "express-session@${EXPRESS_SESSION_VERSION}"

# The app itself (single file, in-memory stores).
COPY app/ ./app/

EXPOSE 3100

CMD ["node", "app/server.js"]
