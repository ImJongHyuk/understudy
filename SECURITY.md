# Security Policy

understudy is an early-stage (`0.x`), single-maintainer open-source project.
Security reports are taken seriously and handled on a best-effort basis.

## Supported versions

Only the latest `0.x` release on `main` is supported; there are no backports.

## Reporting a vulnerability

Please report security issues **privately** — not in a public issue or pull request:

- **Preferred:** GitHub → the repository's **Security** tab → **Report a vulnerability**
  (a private security advisory).
- **Or** email **imjhyuk@gmail.com** with details and reproduction steps.

Please allow a reasonable window for a fix before any public disclosure. As a
single-maintainer project there is no formal SLA, but reports will be acknowledged
as soon as practical.

## Security stance (worth knowing when assessing a report)

understudy's posture is structural, by design:

- **No LLM inside the merge gate (INV-1).** The deterministic gate runs only
  Playwright; LLM authoring/healing happens upstream and is human-reviewed. The
  gate has no model/credential in its path.
- **No secrets in the repo.** Credentials live in the consumer/runner environment,
  never committed. Failure trace artifacts are redacted and leak-checked before
  upload.
- **`cannot-run` reports RED, never a silent skip** — an unreachable target or
  missing precondition fails loudly rather than passing.
- The bundled adapters (`realworld-conduit`, `vikunja`, `oidc`, `cookie-notes`)
  are hermetic examples targeting public / locally-run demo apps only.
