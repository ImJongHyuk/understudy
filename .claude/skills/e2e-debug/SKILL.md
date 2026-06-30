---
name: e2e-debug
description: Turn a failed Playwright run into a structured root-cause for the Healer. Pulls the run's trace.zip from the test artifacts, parses it (failing step + error + the network/console around it), redacts secrets, and hands a structured root-cause hand-off to the playwright-test-healer agent. Use after a deterministic Playwright gate run goes RED and you need to diagnose WHY before any heal is attempted.
---

# e2e-debug — failed-run → structured root-cause (Healer hand-off)

This skill is the **diagnosis half** of the heal round-trip. It runs in the
authoring/healing plane, NEVER inside the merge gate (INV-1: the deterministic gate
carries no LLM, and a cannot-run is RED — see below). It takes a single FAILED
Playwright run, reconstructs what actually happened from the run's `trace.zip`, and
emits a structured root-cause object that the `playwright-test-healer` agent consumes
to propose a fix on a separate `e2e-healer/*` branch.

It does **not** edit tests, does not re-run the gate, and does not decide "pass" — it
only produces evidence. The Healer (with its INV-6 HARD CONSTRAINTS) owns the fix; the
deterministic gate owns green.

## When to use

- A gate run (e.g. `playwright test`) finished RED and you have its artifacts.
- You need a precise failing-step + error + surrounding network/console picture before
  proposing a heal, instead of guessing from the terminal tail.

## Inputs

- The failing test's identity: `file::describe::title` (or the spec path).
- The run's artifact location. With `trace: 'retain-on-failure'` (the config default),
  Playwright writes a `trace.zip` per failed test under the run's results dir:

  ```text
  test-results/<spec-path>-<test-title-slug>-<project>/trace.zip
  ```

  (Also surfaced inside `playwright-report/` as a "Trace" attachment when an HTML
  reporter is configured.)

## Procedure

### 1. Locate the trace artifact

Find the `trace.zip` for the failed test under the results dir. Do not assume one
exists — `retain-on-failure` only writes a trace when a test actually failed.

```bash
# all traces from the last run
find test-results -name 'trace.zip'
# narrow to one failing test by its result-dir slug
find test-results -path '*<test-title-slug>*' -name 'trace.zip'
```

If **no** `trace.zip` is found, that is itself a finding — STOP and report it. A red
run with no diagnosable trace is a cannot-run for this skill: surface it as RED, never
silently skip it (INV-1). Likely causes to report: the failure was in `globalSetup` /
the `setup` project (before tracing started), the run was `trace: 'off'`, or the
process crashed before flushing.

### 2. Parse the trace

Prefer a non-interactive read so this is scriptable. Two equivalent paths:

```bash
# A) interactive viewer (human spot-check only; do NOT block the pipeline on it)
bunx playwright show-trace test-results/<…>/trace.zip

# B) programmatic summary — unzip the trace and read the *.trace JSONL events,
#    which is what the skill should rely on for a structured extract
mkdir -p .tmp/trace && (cd .tmp/trace && unzip -o ../../test-results/<…>/trace.zip)
```

A Playwright `trace.zip` contains newline-delimited JSON event records (`*.trace`,
`*.network`) plus snapshots and attachments. The events carry, per action: the API
name, the call's input (selector / URL), `before`/`after` timestamps, and — on the
failed action — an `error` with `message` + `stack`. The last `error`-bearing action
is the failing step.

### 3. Extract the failing step + error

From the parsed events, pull:

- **Failing step**: the action `title`/`apiName` (e.g. `expect.toHaveText`,
  `locator.click`) and its `params` (the locator string / URL / expected value).
- **Error**: `message` and the top frames of `stack` (map back to the spec line).
- **Category** (classify, do not guess blame): one of
  - `locator-not-found` (selector resolved to 0 / wrong element),
  - `assertion-mismatch` (matcher saw a value ≠ expected),
  - `timeout` (action/expectation never satisfied in budget),
  - `navigation/network` (a request the step depended on failed / 4xx-5xx),
  - `setup/auth` (the protected surface was anonymous — probe/`storageState` issue),
  - `app-error` (a console/page error, not a test mismatch).
- **Context window**: the last few network requests (method, URL path, status) and any
  console `error`/`warning` immediately before the failing action — this is what
  distinguishes "the app changed" from "the test drifted".

### 4. Redact BEFORE handing off (HARD)

A trace can carry auth headers, cookies, tokens and seeded secrets. Anything this
skill emits — quotes from the trace, network lines, the structured object — MUST be
run through the core redactor first. Use `core/redact-trace.ts`:

```ts
import { buildDenylist, scanForLeaks, redact } from './core/redact-trace'

// the adapter supplies its env var NAMES + any project-specific key SHAPES;
// the core ships the generic header names + Bearer/Basic/JWT shapes.
const dl = buildDenylist({ envNames: adapter.secretEnvNames, extraPatterns: adapter.keyShapes })
const safe = redact(rawExcerpt, dl)
if (scanForLeaks(safe, dl).length > 0) throw new Error('cannot-run: trace excerpt still leaks after redaction')
```

Never paste a raw header/cookie/token value into the hand-off. If a leak survives
redaction, STOP (cannot-run RED) rather than emit it.

### 5. Hand a structured root-cause to the Healer

Emit ONE compact object (redacted) and pass it to the `playwright-test-healer` agent.
Shape:

```jsonc
{
  "test": "adapters/realworld-conduit/specs/articles-journey.spec.ts::Articles::publish an article",
  "trace": "test-results/<…>/trace.zip",
  "failingStep": { "api": "expect.toHaveText", "params": { "locator": "getByRole('heading')", "expected": "/My new article/" } },
  "error": { "category": "assertion-mismatch", "message": "<redacted matcher diff>", "specLine": 42 },
  "context": {
    "network": [{ "method": "POST", "path": "/api/articles", "status": 200 }],
    "console": []
  },
  "hypothesis": "Heading rendered as 'my new article' (lowercased by the app); the regex anchor expected title-case.",
  "evidence": "POST /api/articles returned 200 with the lowercased title — app-side change, not a flaky locator."
}
```

Rules for the hand-off:

- **Diagnose, do not prescribe a weakening.** State what reality is vs what the test
  expected. Do NOT suggest "relax the matcher" / "add a skip" / "bump the timeout" —
  those are exactly the moves the post-Healer lint rejects (see the Healer doc).
- **Distinguish test-drift from a real regression.** If the evidence shows the APP's
  behaviour changed (the flow genuinely broke), say so plainly: the correct outcome
  may be to leave the test RED and escalate, because the harness just caught a bug.
- **Stay generic.** Use only generic terms and the public RealWorld/Conduit reference.
  No internal hosts, realms, vaults, product names, or key prefixes in any example or
  output.

## Boundaries / invariants

- **No LLM in the gate (INV-1).** This skill runs upstream of the deterministic gate;
  its output is reviewed and the gate re-runs from scratch on a new SHA.
- **cannot-run = RED, never a silent skip.** Missing trace, unreadable trace, or a
  post-redaction leak each STOP with a RED report — they are not skipped.
- **Evidence only.** The skill never edits a spec, never marks anything green, never
  touches `core/` / trust-gate policy. The Healer proposes the fix on `e2e-healer/*`;
  green is asserted solely by a deterministic re-run.
