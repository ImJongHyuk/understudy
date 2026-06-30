<!--
  ⚠️ TEMPORARY / DRAFT — experiment design; measurement DEFERRED ⚠️
-->

# Healer model-tier delta — experiment design (DRAFT)

> **MEASURED 2026-06-18 (expanded taxonomy) — see [Results](#results--2026-06-18-expanded-break-taxonomy-preferred-models).**
> A runnable harness exists (`scripts/a3-heal-measure.ts`) and the measurement was run
> over OpenRouter through a swappable tool-calling bridge (a LiteLLM / self-host endpoint
> drops in unchanged). The premium golden ceiling was **NOT** run (by choice), so the
> numbers are ABSOLUTE success-rates, not the ceiling-relative 20pp delta. The preferred
> cheap models (`deepseek-v4-flash`, `mimo-v2.5`) score **20/20** across four break
> classes (name / role / text / exact-case) — strong for single-locator heals. A fifth,
> root-cause FLOW break (fix an UPSTREAM line, not the one that errors) drops deepseek to
> **4/5** via a vacuous-no-edit miss — so cheap models are NOT yet trustworthy where the
> fix is on a different line than the failure. Nothing here touches the deterministic gate
> (INV-1): the gate carries NO LLM and is only the PASS/FAIL oracle.

## Why this experiment exists

The harness runs LLM agents (Planner / Generator / Healer) **upstream** of a
deterministic Playwright merge gate. The Healer is the agent that, on a failing
test, pulls the trace, root-causes, and proposes a fix as a **separate patch**
(never auto-greening the gate). Because Healer output is topologically safe — it
lands on its own `e2e-healer/*` patch branch, must re-pass the deterministic gate,
and is human-reviewed — a wrong heal is *harmless*. That safety is what makes a
**cheap model** a credible seat for the Healer.

But "cheap model" cannot be assumed cheaply. The Healer's job is **agentic
tool-use**, not text reasoning:

- multi-step function-calling,
- driving a trace CLI (open trace → read steps → locate the failing action),
- driving a browser (re-run, inspect the live DOM / accessibility tree),
- emitting a minimal, well-formed patch.

A model that scores well on chat / reasoning / summarization benchmarks is
**unproven** at this loop. So before the harness defaults the Healer to a cheap
tier, we measure the delta against a premium ceiling on the **same** induced
break, and gate the default on a numeric bar.

## Method (ordered — ceiling FIRST, then the swap)

The order is load-bearing: establish the **premium golden ceiling first**, then
measure the **cheap-model swap** as a delta *against that ceiling*. A cheap
absolute number is meaningless without the ceiling, because the ceiling tells you
whether the break is even healable by this harness at all.

### Step 0 — fix the induced break (the constant under test)

- Run on the **hermetic RealWorld / Conduit reference consumer**
  (`adapters/realworld-conduit`): credential-free, brought up locally, so the
  experiment is reproducible by anyone with model access and leaks no secrets.
- Induce **ONE** behaviour-level break and pin it as a fixture (e.g. a renamed
  selector / moved control / changed copy on a covered flow). It must be a
  **fresh, dedicated fixture**, NOT a break reused from another test phase —
  reusing a shared induced break risks cross-run / shared-env contamination of
  the heal attempts.
- Confirm the break makes the target test go **RED deterministically** before any
  heal attempt (a true regression, not a flake).
- Hold this break **identical** across every attempt and both tiers. It is the
  single independent variable's *constant*; the model tier is the only thing that
  changes.

### Step 1 — premium golden ceiling

- Point the Healer at a **premium** model (the same tier used for intent-bearing
  agents).
- Run **N ≥ 5** independent heal attempts on the SAME induced break (fresh agent
  state each attempt; same trace input).
- Score each attempt PASS/FAIL by the **deterministic gate only**: an attempt
  *succeeds* iff the Healer's proposed patch makes the previously-RED test go
  GREEN on a clean deterministic re-run, **without** any forbidden move (no
  `test.skip` / `test.fixme`, no test-count reduction, no assertion weakening, no
  matcher downgrade — the same post-Healer lint the gate enforces). An attempt
  that greens by cheating counts as **FAIL**.
- Record `ceiling = passes / N` (a success-rate, e.g. 5/5 = 100%, 4/5 = 80%).

### Step 2 — cheap-model swap

- Swap ONLY the Healer model to a **cheap hosted** tier through the model-agnostic
  bridge (external aggregator or self-hosted endpoint). Everything else — the
  break, the trace input, the agent prompt/tools, the scoring rule — stays
  identical.
- Run the **same N ≥ 5** attempts on the **same** induced break.
- Record `cheap = passes / N` under the identical PASS/FAIL rule.

### Step 3 — decide against the numeric bar

Compute the delta and apply the bar below. Record the decision.

## The metric

**Metric = success-rate over N ≥ 5 heal attempts on the SAME induced break**, where
a single attempt *succeeds* iff its proposed patch turns the RED test GREEN on a
clean deterministic re-run with **zero** forbidden moves.

- Sample size: **N ≥ 5** per tier (same break, independent attempts).
- Unit: a Healer round-trip (trace in → patch out → deterministic re-run), graded
  by the gate, never by an LLM judge.
- The metric measures **agentic tool-use**, not text quality: a model can write a
  beautiful root-cause narrative and still FAIL because it never drove the trace
  CLI / browser to the actual broken step or emitted a malformed patch.

## The numeric bar (this is the thing that flips the default)

> **HEAL-MODEL default flips to cheap-by-default ONLY IF:**
>
> ```text
> cheap_success_rate  >=  ceiling_success_rate  -  20pp
> ```
>
> i.e. the cheap tier is within **20 percentage points** of the premium golden
> ceiling over N ≥ 5 attempts on the same induced break. Otherwise the Healer
> default stays **premium**.

Worked examples (N = 5):

| ceiling | cheap | delta | decision |
| --- | --- | --- | --- |
| 100% (5/5) | 100% (5/5) | 0pp | cheap-by-default ✅ |
| 100% (5/5) | 80% (4/5) | 20pp | cheap-by-default ✅ (exactly at the bar) |
| 100% (5/5) | 60% (3/5) | 40pp | stay premium ❌ |
| 80% (4/5) | 60% (3/5) | 20pp | cheap-by-default ✅ |
| 80% (4/5) | 40% (2/5) | 40pp | stay premium ❌ |

Notes on the bar:

- **20pp is deliberately generous** *because* the Healer is topologically safe: a
  wrong/empty cheap heal costs only a retry and a human glance, never a false
  green. The bar trades a modest, harmless miss-rate for cost. If the safety
  story changed (e.g. a heal could ever auto-merge), the bar would have to be far
  tighter — but it can't, so 20pp holds.
- **The bar is on success-rate, not on cost or latency.** Cost/latency are
  tie-breakers only *after* the bar is cleared; a cheap model that misses the bar
  is rejected no matter how cheap.
- **A degenerate ceiling rejects the experiment.** If the premium ceiling itself
  is low (e.g. ≤ 40% / 2-of-5), the break may be ill-posed or the Healer
  prompt/tools inadequate — fix the harness and re-measure rather than reading a
  cheap-vs-premium delta off an unhealable break.
- **N ≥ 5 is a floor, not a ceiling.** Wider N tightens the estimate; report the
  raw `passes/N` for both tiers so the delta is auditable, not just the verdict.

## Agentic tool-use ≠ text reasoning

This is the whole reason the experiment is *measured* and not assumed:

- The Healer must complete a **multi-step trace-CLI / browser-driving** loop:
  open the failing trace, walk to the broken action, optionally re-run and
  inspect the live accessibility tree, then emit a minimal patch. That is
  function-calling under tool schemas, not free-text.
- Reasoning/chat benchmark standing **does not transfer** to this loop. A cheap
  model can be strong at prose and weak at (a) selecting the right tool, (b)
  passing well-formed arguments, (c) reading tool output and adapting, (d)
  staying within the patch contract.
- Therefore the scoring is **end-to-end behavioural** (did the patch green the
  gate cleanly?), which only succeeds if the full tool-use chain succeeded. We do
  not grade intermediate "reasoning quality."
- Practical precondition for the cheap tier: a self-hosted runner must serve
  **chat + tools** (correct tool-call parsing), not a completion-only wire. A
  completion-style endpoint cannot drive this loop and is disqualified before the
  delta is even measured.

## Data-egress posture (external model vs self-host)

Healing streams real artifacts to the model: DOM / accessibility snapshots,
traces, and whatever app data those carry. The hosting choice is therefore a
**governance** decision keyed to the *consumer's* sensitivity, separate from the
success-rate bar:

- **External aggregator (e.g. OpenRouter)** — the convenient default for
  **low-sensitivity / fast-prototype** consumers (the hermetic RealWorld
  reference is the canonical low-sensitivity case: it has no real data to leak).
- **Self-hosted endpoint** — required for **sensitive** consumers, where
  streaming DOM / traces / real data to a third-party model is an unacceptable
  egress risk. The model-agnostic bridge makes this a **toggle**, not a rewrite:
  same Healer, same delta procedure, different endpoint.
- The success-rate bar and the egress posture are **orthogonal**: a sensitive
  consumer that self-hosts still applies the identical numeric bar to *its
  self-hosted* cheap tier vs *its* premium ceiling. Egress decides *where* the
  model runs; the bar decides *which tier* the Healer defaults to.
- Re-measure per hosting choice when the model differs: a self-hosted cheap model
  is a different model than an external cheap model, so its delta is its own
  experiment.

## What this experiment does NOT touch (invariants)

- **INV-1 — the deterministic gate carries NO LLM.** This experiment grades the
  *Healer* (an upstream agent); the gate is only the PASS/FAIL *oracle*. No model
  is ever introduced into the merge gate.
- **cannot-run = RED.** If model access is missing, the experiment is **DEFERRED
  and reported as not-run** — never silently skipped and never read as "cheap is
  fine." Absent a measured delta, the Healer default stays premium.
- **Healer stays a proposal.** Regardless of tier, every heal lands on a separate
  `e2e-healer/*` patch branch, re-passes the deterministic gate, and is
  human-reviewed. No tier earns an auto-merge.

## Outputs to record when the measurement runs

1. The induced break (fixture id + the flow it breaks) and proof it went RED
   deterministically pre-heal.
2. `ceiling = passes/N` (premium) and `cheap = passes/N`, with the per-attempt
   PASS/FAIL log (and the reason for any cheating-FAIL).
3. The computed delta and the bar verdict (cheap-by-default vs stay-premium).
4. The data-egress posture used (external vs self-host) and the consumer
   sensitivity class it was chosen for.
5. Re-confirmation that the Healer's no-skip / no-fixme / separate-patch / no
   assertion-weakening constraints held across both tiers.

## Results — 2026-06-18 (expanded break taxonomy; preferred models)

Harness: `scripts/a3-heal-measure.ts`. The LLM layer sits behind a small swappable
bridge (raw OpenRouter; a LiteLLM / OpenAI-compatible proxy or a self-hosted endpoint
drops in without touching the loop or scoring). Models + key are read from env
(`A3_OPENROUTER_MODELS`, `OPENROUTER_API_KEY`) kept in the private workbench — **never in
this repo**.

**Agentic surface (3 tools, real multi-step tool-use — not single-shot text):**
`run_test` (a deterministic Playwright run of the spec under heal), `get_accessibility(path)`
(the LIVE app's aria snapshot, so the model finds the REAL control), `replace_in_spec(old,
new)`. The model loops run_test → get_accessibility → replace_in_spec → run_test.

**Break taxonomy (4 classes, each a dedicated fixture on the authed realworld/Conduit
home, confirmed RED before measuring):**
- `name-rename` — wrong accessible NAME (the button exists under a different name).
- `wrong-role` — "New Article" is a link, asserted as a button (wrong ROLE).
- `changed-text` — sidebar heading copy drift ("Popular Tags" vs a wrong name).
- `exact-case` — an over-strict `{ exact: true }` + wrong casing on a real control.

**Scoring (the gate is the oracle, INV-1):** an attempt PASSES iff its patched spec
re-runs GREEN **and** the core `post-heal-lint` finds ZERO forbidden moves (no
skip/fixme/only, no test-count drop, no assertion/matcher weakening, no timeout
widening) **and** the spec actually changed (a no-edit "pass" on an already-RED break is
a vacuous FAIL).

**Results — preferred models, N=5 per cell:**

| break | `deepseek-v4-flash` | `mimo-v2.5` |
| --- | --- | --- |
| name-rename | 5/5 | 5/5 |
| wrong-role | 5/5 | 5/5 |
| changed-text | 5/5 | 5/5 |
| exact-case | 5/5 | 5/5 |
| **total** | **20/20** | **20/20** |

`minimax/minimax-m3` was measured first but **deprioritized**: its partial data showed
name-rename 4/5 — one *vacuous no-edit* FAIL (it ended the loop without proposing an
edit) — before its run was cut short by a hung provider request (see hardening below).

**Read — honest scope.**
- The two preferred models are **rock-solid (20/20) across all four classes** — strong
  evidence that cheap models reliably perform the *dominant* real-world heal: re-resolving
  a single drifted locator (name / role / text / match-strictness) from the accessibility
  tree.
- **Still not fully discriminating** between deepseek and mimo: all four classes are "find
  the real role+name in the aria snapshot and substitute one locator" — the same core
  skill. The genuinely hard classes — **multi-step flow breaks, async/timing, and
  semantic assertion changes** — remain unmeasured and are the next frontier.
- **A controlled 3-tool surface**, not the full packaged `playwright-test` MCP Healer
  (trace-CLI + live browser driving) — a harder loop.
- **No premium ceiling** (skipped by choice) → absolute rates, not the 20pp delta.

### Hard break — root-cause flow (the discriminating one)

The four classes above are homogeneous (single-locator, aria-resolvable). A fifth class
deliberately breaks the FLOW, not a visible locator: `flow-wrong-step` clicks the wrong
UPSTREAM control ("Your Feed", which is empty for this user) so the seeded article never
shows — the line that ERRORS (the visibility assertion) is NOT the line to fix (the
upstream click). An anti-cheat `mustRetain` requires the assertion to keep targeting the
seeded article, so the only way to green is the genuine upstream fix — not gutting or
retargeting the assertion.

Pre-fix (bespoke bridge, rigid pin): deepseek **4/5**, mimo **inconclusive**\*.

**Clean post-fix runs** — `llm/` routing, fully-bounded harness, full N=5:

| break | `deepseek-v4-flash` | `mimo-v2.5` reasoning-OFF (1K) | `mimo-v2.5` reasoning-ON (16K) |
| --- | --- | --- | --- |
| flow-wrong-step | **5/5** | **2/5** | **5/5** |

\*mimo (pre-fix): 0/2 observed (both vacuous), then its provider stalled — at the time read
as provider-availability. Root-caused later (UPDATE below): the real cause was reasoning-on
starving a SMALL token budget → null content / no tool call.

**Reading the numbers — the budget, not the reasoning, was the problem.** Both models heal
single-locator breaks reliably (20/20 earlier). On the root-cause flow break:

- **reasoning-OFF (1K budget): mimo 2/5.** Usable (it always emits a real response), but the
  no-edits are genuine root-cause misses — disabling reasoning removed exactly the deliberation
  that root-causing an *upstream* cause needs.
- **reasoning-ON (16K budget): mimo 5/5** — fully recovered, matching deepseek (5/5). Given
  token headroom so reasoning can't starve the output, mimo both reasons AND emits the fix.

So the sharp lesson is **reasoning needs token headroom**, not "reasoning is bad." The
null-content pathology was reasoning-ON colliding with a *tight* `max_tokens`; the cure is
either (a) reasoning-OFF for cheap/simple heals, or — better for hard root-cause heals —
(b) reasoning-ON with a generous budget. Both are one knob in `llm/` (`route.thinking` +
`openRouter.maxTokens`); A3 exposes `--thinking --max-tokens`. mimo is a strong root-cause
Healer (5/5) when configured for the task; deepseek reaches 5/5 reasoning-off (cheaper there).

**Qwen3 (on-prem candidates) — capability, not format.** Tested `qwen/qwen3.6-35b-a3b`
(atlas-cloud/fp8) and `qwen/qwen3.5-122b-a10b` (alibaba) for on-prem readiness:

| break | qwen3.6-35b-a3b | qwen3.5-122b-a10b |
| --- | --- | --- |
| flow-wrong-step reasoning-OFF | 0/5 | 0/5 |
| flow-wrong-step reasoning-ON (16K) | 0/5 | 0/5 |

Both fail the root-cause flow heal in BOTH modes **under the OLD scaffold** (corrected below in
"Scaffold, not capability" — a better prompt lifts qwen3.5 to 5/5 and qwen3.6 to 3/5). A raw-dump
probe confirms it is **not a parsing/format gap**: through our harness (dual reasoning-off) both emit clean
structured `tool_calls` every turn and heal a *single-locator* break in 4 turns — no
`<think>`/inline leak. On the *root-cause* break they fix the visibly-failing assertion locator
but not the upstream wrong click (qwen3.6 → "test still RED"), or end without an edit (qwen3.5 →
vacuous). So these qwen variants are usable Healers for simple locator drift but weak at
root-causing; mimo (5/5 reasoning-on) and deepseek (5/5) are the stronger cheap root-cause
Healers.

**On-prem note (the qwen peculiarity).** On OpenRouter these providers separate reasoning into a
`reasoning` field, so `content` is clean. On-prem vLLM leaks the chain-of-thought into `content`
as literal `<think>` tags (vLLM #39056), which is why prior production strips them. `llm/` now
exports `stripThinkTags` and the OpenRouter provider cleans the returned `content` — while
tool-call extraction still scans the RAW message, so a `<tool_call>` inside `<think>` is rescued.
Details + the vsync-style handling: docs/PROVIDER-ROUTING-LESSONS.md.

**minimax-m3 — the system gap closed.** `minimax/minimax-m3` (minimax/fp8) is a reasoning model,
but the registry classified it as `other` (no control) — so under a tight budget it hit the same
null-content trap (`finish=length`, reasoning eats the budget, content/tool_calls=null) that was
the original "minimax vacuous" failure. Added a **`minimax` family** (`reasoning.enabled=false`),
verified by probe (default ON → null; disabled → 0 reasoning tokens, clean) + conformance. It is
now correctly handled and measurable — no stall:

| break | minimax-m3 reasoning-OFF | minimax-m3 reasoning-ON (16K) |
| --- | --- | --- |
| flow-wrong-step | 0/5 | 1/5 |

Quality on the root-cause flow heal is weak (like qwen): with reasoning OFF minimax tends to go
conversational instead of calling the edit tool (0/5 vacuous); reasoning-ON engages it a little
(1/5). [Superseded by "Scaffold, not capability" below — most of this gap was the prompt.] The
point of this pass was the **system**: every reasoning model in the catalog (mimo / minimax /
qwen) now has a reasoning-control family, so none silently null-outs under a budget.

## Scaffold, not capability — the gap was mostly the prompt

The 0/5 "genuine capability" reads above (qwen, minimax) were a **scaffold artifact**, not a
ceiling. Evidence: a clue-rich transcript probe showed minimax and qwen3.5 root-cause the flow
break in 3 turns; the old SYSTEM_PROMPT literally said *"A test is failing because a locator no
longer matches"* + *"Fix ONLY the test's locator"* — which biases a model toward fixing the
visible failing locator (the symptom). Strong reasoners (deepseek, mimo) override it; weak models
obey it. (minimax at a 65K budget was still 0/5 — not a budget issue either.)

Applying SkillOpt-style, model-AGNOSTIC scaffold fixes (same prompt for every model):
- **R1** — rewrote the prompt: "the line that ERRORS is often NOT the line to fix; trace the flow;
  a `toBeVisible` failure usually means an UPSTREAM action put the app in the wrong state; fix the
  EARLIEST wrong step."
- **R2** — one root-cause few-shot exemplar (a DIFFERENT app, to avoid teaching to the test).
- **R3** — a forced reflection turn when a test is still RED after an edit ("which earlier step is
  the cause? reconsider the upstream step, not the assertion").
- **R4** — no-vacuous: a prompt rule + a loop nudge so a model can't end with prose and no edit.

Result on flow-wrong-step (reasoning-on, N=5):

| model | BEFORE (old scaffold) | AFTER (R1–R4) |
| --- | --- | --- |
| deepseek-v4-flash | 5/5 | 5/5 |
| qwen3.5-122b-a10b | 0/5 | **5/5** |
| minimax-m3 | 0/5 | **4/5** |
| qwen3.6-35b-a3b | 0/5 | **3/5** |

**No regression** on the single-locator classes (qwen3.6: name-rename / wrong-role / changed-text /
exact-case all 3/3 with the new prompt). So the "capability difference" was mostly the harness
biasing weak models toward symptom-fixing; a model-agnostic scaffold closed most of the gap.
(qwen3.6, the smallest at ~3B active params, keeps a small residual gap.) Fixes live in the heal
loop (`scripts/a3-heal-measure.ts` SYSTEM_PROMPT + runHealLoop). The deterministic gate is exactly
the verifier SkillOpt needs (microsoft/SkillOpt) — a future step could *learn* the skill doc
against it instead of hand-authoring R1–R4. Harness note: `get_accessibility` now reuses ONE
browser (per-call contexts) — re-launching+closing a browser every call leaked chromiums until the
host starved and the run stalled.

> **UPDATE (root-caused + fixed).** The mimo confound was **configuration, not capability** —
> and the primary cause was **reasoning-on-by-default**, not routing. Reproduced live: at a
> finite `max_tokens`, mimo spends the budget on hidden reasoning, hits `finish_reason=length`,
> and returns **null content / no tool_call** — exactly the `vacuous`/`stall` we saw. Disabling
> reasoning (`{"reasoning":{"enabled":false}}`) makes it deterministic and clean (0 reasoning
> tokens, a tool call every run). The fix lives in `llm/`: per-family reasoning control
> (`reasoning.ts`, default thinking-off — grok/mimo/glm/qwen3, with the Qwen3 dual payload),
> plus secondary hardening (tool-capable `require_parameters` routing, prefer-with-fallback
> instead of a rigid single-provider pin, a circuit breaker, and defensive tool-call
> normalization). A3 routes through it, so **mimo is now measurable**. Full write-up + the
> live reproduction table + references: `docs/PROVIDER-ROUTING-LESSONS.md`.

**This is the discriminating result.** Unlike the single-locator classes (20/20),
deepseek drops to **4/5** on the root-cause flow break — every miss is the same
`no edit (vacuous)` failure mode: the model fixes a *visibly* failing locator perfectly
but sometimes fails to root-cause to a *different, upstream* line and ends without an
edit. So cheap models are reliable for the common "the failing line's locator drifted"
heal, but not yet trustworthy for root-cause heals where the fix is elsewhere.

Two scope notes: (1) a **structural-insert** class (a heal that must ADD a missing step)
was attempted but is NOT cleanly measurable with a replace-only tool surface — it
conflates model skill with tool ergonomics; a future `insert`/diff tool is needed.
(2) **Provider availability is operationally real:** `xiaomi/fp8` stalled repeatedly this
session while `deepseek/alibaba` stayed stable — reinforcing the deepseek preference and
motivating the bridge's tightened per-request budget (3 × 35s abort+retry) so a Healer
fails fast on a dead provider instead of hanging.

**Harness hardening found during this run.** minimax's slow provider exposed a missing
**per-request fetch timeout** in the bridge: one hung connection blocked the whole
sequential run. Fixed — each model call now aborts after 60s and retries, so a hung
provider degrades to a bounded failed attempt, never an infinite hang.

**Model preference (recorded).** Prefer `deepseek-v4-flash` and `mimo-v2.5` over
`minimax-m3` — cheaper ($0.09 / $0.14 vs $0.30 per M prompt) and more reliable here (no
vacuous fail, no provider hang).

**Decision.** deepseek/mimo are reliable for single-locator heals (20/20 — the common
case). On the root-cause flow break deepseek holds ~80% (4/5) via the vacuous-no-edit
miss; mimo's flow number is provider-confounded. Because the gate makes a wrong/empty
heal harmless, an ~80% root-cause rate is usable as a **first-pass Healer with human
review on misses** — but NOT yet an unattended default. Before flipping the repo-wide
default to cheap: (a) broaden the hard classes (timing / semantic + a clean
structural-insert via an `insert` tool), (b) pin a STABLE provider (`deepseek/alibaba`),
(c) keep the bounded bridge — ideally re-run through the packaged MCP Healer. Egress:
external OpenRouter is fine for the hermetic reference (no real data); a sensitive
consumer self-hosts and applies the same bar.

**Reproduce:** source the private env (key + `A3_OPENROUTER_MODELS`), `bun run
realworld:up`, then `bun scripts/a3-heal-measure.ts --n=5` (or `--dry-run` for a
no-docker loop check, `--break=<id>` / `--model=<id>` to scope).
