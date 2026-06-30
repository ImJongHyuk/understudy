# Heal quality — raising weak-model root-cause (living doc)

A deep-research-grounded campaign to fundamentally improve heal QUALITY, especially making cheap/
weak models root-cause **generalizably** (across break flavors), not symptom-fix. Updated as we
implement + measure.

## The frame that was being conflated

Four different things — our problem is only the last:

1. **edit-apply reliability** — can the model land a well-formed edit? (exact-substring `replace_in_spec`
   is the literature's worst format for weak models; near-misses on indent/spacing silently fail.)
2. **gate-pass** — does the patch turn GREEN without tripping lints?
3. **fix-choice** — does it edit the *right line*?
4. **generalizable root-cause** — does it trace upstream *across flavors it wasn't scaffolded for*?

Format fixes (1) and best-of-N (2) buy big, cheap pass-rate wins but **do not move (4)** — and
best-of-N actively risks gaming a sound-but-narrow gate. Only **structural localize/edit separation
+ grounded backward-trace + a contrastive fix-library** move (4). The spine of the research:
**structure of observation/reasoning beats model tier for upstream root-causing** (FALAT; least-to-most
OOD transfer; Agentless). Our weak models have the capability; the harness was starving it of
structure (it hands them a truncated "timed out" tail that *points at the failing line* → induces
symptom-fixing).

## Ranked plan (impact on (4) ÷ cost) — status

| # | Move | Targets | Status |
| --- | --- | :---: | --- |
| A | **Robust edit-apply** (`applyReplace`: exact → whitespace-flexible → numbered-miss hint; `rewrite_spec` fallback later) | (1) | **DONE** — `heal/edit.ts`, wired into real+mock tools, conformance 142→148 |
| B | **Real failure-state trace** — `run_test` returns Playwright's `error-context.md` on failure = the error + the **page aria snapshot at the moment of failure** (no trace parsing; the model sees what its steps actually produced, e.g. an empty "Articles not available" view) | (4) high | **DONE** — `heal/real-tools.ts` + skill line; measuring the gap |
| C | **Grounded LOCALIZE turn before edit** — a harness-enforced `localize` tool (`{failing_assertion, upstream_step, evidence, planned_edit}`); the first edit is rejected until it's called. Tool-grounded, not prompted | (4) high | **DONE** — closes nav-editor 25→100% (Newcombe +75pp, lo>0) |
| D | **Re-localize-as-reflexion on still-RED** — unified with C: a still-RED edit forces a FRESH localize before the next edit, so the model must re-read the new failure page-state and re-trace (structured reflection) rather than blind-retry | (4) med-high | **DONE** — same mechanic (measured with C) |
| E | **Best-of-N + gate selector** — sample K rollouts, the deterministic gate picks a passing one | (2) high, (4) low | **DEFERRED by design** — credits pass-rate (2), NOT generalizable root-cause (4, our goal); risks gaming the gate; our REAL gate is already behaviour-level. Revisit only if pass-rate, not root-cause, becomes the bottleneck (e.g. an unattended-with-review Healer). |

**Load-bearing caveats** (so we don't fool ourselves):
- **(A) credits metric (1), not (4).** Robust-apply removes a confound — some "vacuous no-edit" /
  "still RED" misses were apply-failures masquerading as reasoning failures. It makes the *real*
  root-cause number measurable; it does not by itself raise it.
- **(E) best-of-N games the gate.** As K rises it becomes a search for the gate's weakest seam
  (APR patch-overfitting; resampling-limits). Tighten `score()` (AST-level per-assertion lint;
  behaviour-level negative control on every acceptance) BEFORE raising K. Credit it to pass-rate,
  not root-cause; pair with B/C so the samples are root-cause samples, not lottery tickets.
- **(C) the localize must be TOOL-GROUNDED, not prompted.** A prompted "trace the flow" is
  unfaithful-CoT post-hoc rationalization (this is exactly why R1–R4 was flavor-specific). Ground it
  in the trace (B). Give the model the upstream *region/flow*, not a pinned line (a pinned line is
  what induces symptom-fixing).

## Measured: the trace lever closes PART of the generalization gap

A/B on the real gate (qwen3.6 — the weakest model, the one that was 0/4 on nav; naive vs
hand-authored R1–R4, per fixture, n=4, **with the trace lever + robust-apply**):

| skill | feed-tab | nav-settings | nav-editor |
| --- | :---: | :---: | :---: |
| naive | 50% | 0% | 0% |
| hand-authored R1–R4 | **100%** | **50%** | 0% |

**The headline:** hand-authored R1–R4 on **nav-settings went 0% → 50%** — a flavor it *completely
failed* (0/4) before the trace. feed-tab rose to 100%. This is direct evidence for the research
thesis: it's not the hand-written flavor pattern but the **runtime evidence** (the failure-state
aria snapshot showing what the steps produced) that lets the skill generalize to an unseen flavor.

**Honest nuance (so we don't over-claim):**
- **naive on nav is still 0%** — the trace alone isn't enough; *skill + trace together* close the
  gap (you need a root-cause routine to exploit the evidence). This matches the plan: B enables C/D.
- **nav-editor is still 0%** for both — not every flavor closed. The editor is a form, so its
  failure snapshot is a weaker clue than feed-tab's "Articles not available" / settings' page; or
  it's n=4 noise. A candidate for the grounded-localize (C) lever and higher n.
- **n=4 → 50% = 2/4** (wide Wilson CI). The DIRECTION is real (0/4 → 2/4); precise numbers need
  higher n + the paired McNemar eval. Also confounded with robust-apply (both landed together) —
  a clean 3-way (base / +apply / +apply+trace) would attribute exactly, but the combined loop
  improvement lifting nav 0→50% is already the win.

## Measured: levers C+D (grounded localize) CLOSE nav-editor — clean attribution

Clean A/B on the real gate (qwen3.6, n=4) with **localize OFF vs ON** as the ONLY difference (same
session, same model, same n, same maxSteps=8, trace + robust-apply in BOTH arms) — so this isolates
the C/D effect:

| skill / arm | feed-tab | nav-settings | nav-editor |
| --- | :---: | :---: | :---: |
| hand-authored — localize OFF (trace-only) | 100% | 50% | 25% |
| hand-authored — localize ON (C+D) | 100% | 50% | **100%** |
| naive — OFF / ON | 75% / 75% | 0% / 0% | 0% / 0% |

**Headline:** hand-authored **nav-editor 25% → 100%** (Newcombe Δ = +75pp, 95% CI [+9, +95], lo>0 →
significant even at n=4 — a 1/4→4/4 jump). **No regression** on feed-tab (100%) or nav-settings
(50%). nav-editor is **closed**.

**Clean attribution of the whole campaign** (qwen3.6 hand-authored, nav flavors):

| stage | nav-settings | nav-editor |
| --- | :---: | :---: |
| start (no trace / apply / C-D) | 0% | 0% |
| + trace lever + robust-apply | 50% | 25% |
| + levers C+D (grounded localize) | 50% | **100%** |

So **trace+apply** lifted nav off the floor (0→25–50%) and **C+D** closed nav-editor (25→100%). Both
levers were necessary; neither alone did it.

**Two honest nuances:**
- **naive did NOT benefit from C+D** (nav still 0% both arms). The forced localize tool alone is not
  enough — the SKILL must frame how to use the evidence. So C+D is *skill × structure*, not pure
  harness magic: it amplifies a root-cause-framed skill, it doesn't create one. (This is also why a
  *learned* skill that exploits the localize is the next target.)
- **nav-settings stayed 50%** under C+D — not every flavor is fully closed; 50% may be this model's
  ceiling on that fixture, or n=4 noise (the trace-only run earlier even logged it at 0% once). A
  candidate for higher n + the learning e1.

## Measured: the gate LEARNS the gap-closing skill (learned ≥ hand)

The C+D levers above are *skill × structure* — they amplify a root-cause skill, they don't author
one (naive+C/D stayed 0% on nav). The final move is to let the **gate author that skill**. A
GEPA-Pareto learning loop (per-fixture held-out frontier) with a **localize-aware optimizer** — the
`propose()` step now tells the optimizer the healer runs under the grounded-localize harness + the
failure page-state, so it can write text that exploits that evidence (a *blind* optimizer cannot
invent the framing) — closes the remaining learned↔hand gap on the real gate (qwen3.6, C/D ON,
train=`flow-nav-settings`, held=[`flow-feed-tab`,`flow-nav-editor`], n=5, 5 epochs):

| skill | feed-tab | nav-editor | aggregate (n=10) |
| --- | :---: | :---: | :---: |
| naive | — | 0% | **40%** [17–69%] |
| **LEARNED** (this run) | 100% | **80%** | **90%** [60–98%] |
| hand-authored R1–R4 | — | (~100% under C/D) | **80%** [49–94%] |

**Headline:** **LEARNED 90% ties hand 80%** (Newcombe Δ=+10pp [−24,+42], n.s.) and **beats naive
40%** (Δ=+50pp [+8,+75], significant). On the hard flavor, learned **nav-editor 0%→80%** vs the
prior learning round's 0% (Δ=+80pp [+19,+96]); it climbed monotonically per accepted epoch
(0→40→60→80). The optimizer *authored* the hand-written framing — its deployed skill literally says
"the failing assertion is a symptom, not the bug … fix that step. Never touch the assertion." So the
campaign's loop is complete: **B (trace) enables C/D (localize), C/D + a localize-aware optimizer
let the GATE learn the root-cause skill** — no LLM in the gate (INV-1), the LLM only proposes; the
held-out gate disposes.

### Factorial: it was the AWARENESS signal, not the extra budget

Round 2 moved three levers together (n, epochs, optimizer-awareness). The `--blind-optimizer`
control isolates them: keep the budget high (n=5, 5 epochs) and rollout-localize ON, but **blind the
optimizer** (no awareness note). A 2×2 over the hard flavor:

| | blind optimizer | aware optimizer |
| --- | :---: | :---: |
| **low budget** (2ep, n3) | nav-editor 0% (round 1) | — |
| **high budget** (5ep, n5) | nav-editor **0%** (◆) | nav-editor **80%** (round 2) |

The blind optimizer at HIGH budget learned **nothing** the naive skill didn't already have (LEARNED
aggregate 50% = naive 50%; nav-editor 0/5, every epoch 0%). Raising budget with a blind optimizer
moved the hard flavor **0%→0%** (Δ=+0pp [−43,+43]); adding awareness at the same budget moved it
**0%→80%** (Δ=+80pp [+19,+96], **significant**). The aggregate effect (+40pp [0,+68]) dilutes to
n.s. because feed-tab saturates in both arms — the per-flavor nav-editor contrast is the clean read.
**So the closed gap is the awareness SIGNAL, not extra search** — direct evidence for the spine of
this campaign (structure of observation/reasoning > brute compute for upstream root-causing). Honest
limits: two independent runs, n≤10 (wide CIs); the significant claim is the nav-editor per-flavor one.

## Diagnosis: the nav "ceiling" is fix-grounding, NOT root-cause (n=8 + trace dump)

Higher-n + a rollout-trace dump (`heal/diagnostics.ts`, `--dump`) re-measured the nav flavors and
showed what the model actually does. Two findings:

**1. The earlier per-flavor "closed/stuck" split was mostly small-n noise.** At n=8 (vs the prior
n=4/5), hand-authored with localize ON sits at **nav-settings 63% (5/8) [31–86%]** and **nav-editor
50% (4/8) [22–78%]** — overlapping CIs, no real "editor closed / settings stuck" gap. naive is
**0/8 on both** (skill ≫ naive is the robust claim). The C/D "nav-editor 25→100%" and round-2
"learned nav-editor 80%" point estimates were inflated by n≤5 luck; the honest level is **~50–63%
on both nav flavors, with real headroom remaining.**

**2. The residual ~40% is fix-grounding, not reasoning.** Every single trace localizes the upstream
wrong navigation correctly (`goto('/#/settings')` / `goto('/#/editor')` named as the cause) — the
generalizable root-cause goal is essentially **met**. The failures are in choosing the FIX:

- **URL guessing.** The model tries `goto('/#/article/' + article.slug)` — but the seed resource
  exposes the slug as `.id` (`{kind, id, name}`), so `article.slug` is `undefined` → `/article/undefined`
  fails. Switching to `article.name` passes. The model assumes a route shape from a field that
  doesn't exist instead of grounding it.
- **Two valid fixes, neither in the evidence.** `goto('/')` + click "Global Feed" (the authed default
  tab is the empty personal feed) OR `goto('/#/article/<name>')` both work, but which/how isn't
  derivable from the failure page-state — so the model guesses and burns `maxSteps=8` by trial.
- **Occasional assertion-swap cheat** (`expect(heading 'Your Settings')`), correctly caught by the
  gate (`dropped article.name`).

So the nav ceiling is the **observe-vs-guess principle on the FIX side**: the model root-causes well
but invents routes instead of navigating via observed affordances.

**Lever tried — a skill addition (*navigate the way the app does; don't assemble URLs from data
fields*) — was a NULL result on pass-rate** (n=8: nav-settings 5/8→5/8; nav-editor 4/8→3/8, n.s.;
feed-tab 8/8, no regression). The traces show it *did* change behaviour — the model grounded more
(get_accessibility calls up) and correctly verbalized *"replace the guessed URL with UI-based
navigation, go home, click Global Feed"* — but two realities capped it:
1. the model still tries the wrong guess (`article.slug`) FIRST, burning `maxSteps`;
2. **`get_accessibility(path)` is goto+snapshot only — it cannot click**, so an interaction-gated
   target (the seeded article lives behind the "Global Feed" tab, not on the authed default feed) is
   unreachable by static path-grounding — the model can't *see* the fix it's told to ground.

So prompting the right routine isn't enough (the C/D lesson again: only harness-ENFORCED grounding
transfers). We **reverted** the unvalidated skill prose (the gate disposes — accept only on strict
improvement).

### Harness lever built: a grounding PROBE — and the next wall (capability ≠ use)

We built the harness fix the evidence pointed to: **`get_accessibility(path, clicks)`** clicks named
affordances IN ORDER after navigating, then snapshots — so interaction-gated state is reachable, not
guessed (`heal/probe.ts`, backward-compatible, conformance 172→176; disclosed via the tool SCHEMA,
not skill prose). Mechanism check: the click executes cleanly (no error). But the gate A/B was again
a **NULL on pass-rate** (n=8: nav-settings 5/8→5/8; nav-editor 4/8→5/8, n.s.) for a sharp reason —
**the weak model invoked `clicks` ZERO times** (every `get_accessibility` call was `{path}` only).

That is the campaign's recurring lesson at a third level: **capability ≠ use.** What moved weak
models here was never mere availability or prose — it was (a) harness ENFORCEMENT (localize C/D,
+75pp) or (b) a LEARNED skill the gate taught (round 2, awareness-driven). So the probe is the right
*mechanism* but needs a *driver*: the next lever composes the two proven ones — make the optimizer
**probe-aware** (tell it `clicks` exists, exactly as we made it localize-aware) and let the gate
**learn** a skill that grounds gated state, and/or **enforce** a probe before a navigation edit. We
**keep** the probe (sound, tested, backward-compatible infrastructure; it claims no win). Honest
scope note: these nav fixtures are a small, somewhat artificial corpus — the deeper frontier remains
fixture diversity (a richer reference app), where grounding-vs-guessing recurs in many shapes.

## Measured: the GROUNDING lever — wait for async render (closes the dynamic-page gap)

A richer reference app (Vikunja, `adapters/vikunja/`) exposed the next facet of grounding — and it
was a real harness bug, not a model limit. Source-relabel drifts on a control behind a per-run
DYNAMIC URL (`/projects/{id}`, a client-rendered view with an async data fetch) were **vacuous**: the
`--dump` trace (now captured by `heal/heal-loop.ts` → `scripts/heal-real-break.ts --dump`) showed the
model navigated to the RIGHT url, but `get_accessibility` returned the SPA's *"loading…"* placeholder
— it waited only for `domcontentloaded`, before the route's data fetch + render — so no real controls
were in the snapshot and the model blind-guessed.

**The fix (`heal/real-tools.ts` + `heal/settle.ts`): `get_accessibility` now WAITS for the async
render to settle before snapshotting — production-grade, EVENT-BASED.** `settleRender` does
`networkidle` (opportunistic, bounded so a websocket/long-poll app can't hang) THEN a DOM-quiet wait
(an in-page `MutationObserver` resolving once the DOM is quiet for `SETTLE_QUIET_MS` or the hard
`SETTLE_CAP_MS`; the decision `renderSettled` is conformance-tested). networkidle-first means the data
fetch's loading→content swap already happened, so we don't settle on the placeholder; DOM-quiet then
absorbs post-fetch render waves and works even when the network never idles. With the rendered view in
the snapshot, the model grounds the relabelled control and heals. Measured on the Vikunja dev stack
(deepseek, the adapter-agnostic driver): the two previously-vacuous dynamic-page drifts (a
`getByPlaceholder` and a `getByRole('button')` on the seeded project view) now **PASS**, **no
regression** on static-route heals. Generic (any client-rendered SPA), backward-compatible. This
subsumes part of the earlier "interaction-gated" framing: the page was reachable; it was snapshotted
too early. (Evidence: `adapters/vikunja/HEAL-EVIDENCE.md`.)

Diagnosis is now uniform: `--dump` (the `runHealLoop` `StepRecord[]` trace via `heal/diagnostics.ts`)
is wired into ALL heal entry points — `heal-real-break.ts`, `a3-heal-measure.ts`, and
`skill-optimize.ts` — so any heal failure on any path/app can be triaged the same way (it's how the
"loading…" snapshot bug above was found).

Two production hardenings landed on top (built in parallel, integration-validated):
- **Per-target settle budget.** `heal/settle.ts` `resolveSettle` + `HealTarget.settle` let a consumer
  override `{ quietMs, capMs, networkidleMs }` (clamped to sane bounds); `settleRender(page, settle)`
  threads it. Omit → today's defaults (backward-compatible). A websocket-heavy app can raise the cap
  / drop networkidle without touching `core/`.
- **Auto failure-triage.** `heal/triage.ts` `triageRollout({passed, reason, steps})` classifies a
  rollout into a category (`grounding-empty` / `apply-failure` / `still-red-wrong-fix` /
  `vacuous-no-edit` / `dropped-assertion` / `forbidden-move` / `loop-error` / `healed`) and names the
  next lever. Emitted alongside every `--dump` on all three paths, so a failure self-reports WHICH
  lever to pull (e.g. a `grounding-empty` verdict points straight at the settle/grounding fix). Pure +
  conformance-tested per category.

## Measured: settle hardened for never-idle (long-poll/SSE) apps — DOM-quiet is now PRIMARY

The earlier settle did `networkidle` (bounded) BEFORE the DOM-quiet poller. A load test on a
controlled never-network-idle fixture (`scripts/fixtures/longpoll-server.ts` — an SSE keepalive so the
network never idles + a `loading…`→content swap at ~700ms; `scripts/settle-loadtest.ts` measures the
REAL `settleRender` over 5 iters/variant) exposed TWO real faults: (1) the blocking `networkidle` could
only TIME OUT on a never-idle page, so EVERY snapshot paid its full `networkidleMs` (~6.4s of pure dead
weight; ~15s stacked on a spinner); (2) `networkidle` is not even a safe render signal — it fired at
+500ms while the timer-driven swap landed at +700ms, so a naive race would snapshot the *placeholder*.

**The fix (`heal/settle.ts` `renderSettled` + `heal/real-tools.ts` `settleRender`):** DOM-quiet is the
PRIMARY signal. `renderSettled` now gates on BOTH (a) the render has **landed** — `networkidle` fired
OR a DOM render wave was observed (the OR makes a never-idle app cheap: the content swap IS a mutation,
so no networkidle timeout is paid) — AND (b) the DOM has since been quiet for `quietMs`, measured from
the LATER of the last mutation and the landed moment (so a networkidle landing on a momentarily-quiet
placeholder still waits out an imminent swap). `networkidle` now runs CONCURRENTLY (best-effort,
never awaited on its own → can't hang, can't dominate); the hard `capMs` still forces a snapshot.
Measured (median, integrated state): never-idle **swap 6408ms → 1124ms** (5.7×), **spinner
15054ms → 9052ms** (the 6s penalty removed), `idle`/`static` baselines unchanged (~1.1s / ~0.97s) —
all variants rendered, no placeholder, no hang. Defaults unchanged → INV-1 unaffected, backward-compatible.

## Measured: the triage loop now ACTS — a bounded, deterministic auto-lever loop (`--auto`)

Triage NAMED the next lever; a human applied it. `heal/auto-heal.ts` (`runAutoHeal`, behind
`scripts/heal-real-break.ts --auto`) now CLOSES that loop: heal → score with the deterministic gate →
triage → if the category has a **safely-auto-applicable** lever, apply it and re-heal, bounded by
`maxEscalations` (default 2). INV-1 is preserved end-to-end: the gate is **injected** by the caller
(`score`) and stays the sole oracle; the loop only changes the EVIDENCE BUDGET or does a transient
retry — never the verdict. The auto-applicable scope is deliberately narrow (`heal/escalate.ts`
`planEscalation`, pure + conformance-tested): **`grounding-empty`** → double the render budget
(`capMs`×2, `networkidleMs`×1.5, clamped to the ceilings; terminate when maxed so it can't spin on an
identical budget) and retry — the model had no rendered evidence, so more settle budget deterministically
changes the next snapshot; **`loop-error`** → a plain transient retry. Every other category does NOT
auto-retry: anti-cheat / apply-mechanics (`forbidden-move`, `dropped-assertion`, `apply-failure`) need
a skill/code/human change, and `still-red-wrong-fix` / `vacuous-no-edit` have already spent their cheap
in-loop levers (R3 reflexion / R4 nudge) — a blind resample of a stochastic model is the
intentionally-deferred best-of-N, not an auto-applied lever. Live-validated (Conduit, deepseek): a real
`FeedToggler` "Global Feed"→"All Articles" break healed end-to-end in **1 attempt, escalations: []**
(clean heal, no spurious escalation, GOOD→BAD→HEALED→GOOD-again). The two hardenings are complementary:
the settle fix makes `grounding-empty` rare; the auto-lever loop is the bounded safety net for the residue.

## Measured: DETERMINISTIC auto-probe grounding — the harness opens what the model didn't ask to

The grounding probe (`get_accessibility(path, clicks?)`) can reach interaction-gated controls — IF the
model passes `clicks`. The documented failure was that a weak model often doesn't KNOW to ask
(capability ≠ use): a tab/accordion/menu-gated control stays out of the snapshot and the model
blind-guesses. The fundamental fix is to make the HARNESS surface those controls deterministically,
not hope the model requests them (structure-of-observation over model-tier — the campaign spine).

`heal/auto-probe.ts` (pure, conformance-tested) decides which affordances are SAFE to auto-open; the
live `settleRender`-style application in `get_accessibility` opens them (bounded, best-effort,
re-scanned per click) and appends a labelled sub-snapshot of each revealed state. **Safety is
load-bearing**: grounding runs against the REAL backend with the real `storageState`, so auto-probe
opens ONLY disclosure-semantic controls and NEVER a destructive-named one (`delete`/`submit`/`publish`/
`apply`…) or a CONCEAL control (`hide`/`close`/`collapse`); a wrong click would mutate real data.

The honest finding (live on Vikunja, observe-before-concluding): **real SPAs frequently ship
disclosures as plain `<button>`s with NO ARIA semantics** — "Open project settings menu", "FILTERS",
"SORT" all had no `aria-haspopup`/`aria-expanded`. A purely ARIA-semantic probe under-fires, so
detection combines ARIA signals (role=tab, `aria-expanded=false`, `aria-haspopup`, `<details>`) WITH a
disclosure-name list, gated by the destructive + conceal guards. Two iterations were driven by live
evidence: a single scan only opened the first disclosure (a click re-renders and stales the markers →
re-scan each pass), and a bare "menu" keyword false-fired on "Hide the menu" (→ the conceal guard).
Result: `get_accessibility("/projects/N")` went from a base snapshot to one enriched with the
filters/sort panels and the project-settings menu — surfacing controls absent from the base (e.g. a
"Subscribe" menu item) with ZERO model clicks. Bounded (≤ `MAX_AUTO_DISCLOSURES`), backward-compatible
(no disclosures → exactly the base snapshot), and coverage scales with the app's ARIA hygiene — an
honest limit, not a fit. Scope: this closes the DISCLOSURE-gated class (tabs/accordions/menus/panels);
NAVIGATION-gated surfaces (content reachable only by clicking through, e.g. feed→article) remain the
model-driven `clicks` job.

## Why this should generalize where R1–R4 didn't

R1–R4 taught an *answer pattern* (feed-tab) → 0/4 on the nav flavor. B+C give the model the same
**procedure** for any flavor: the trace surfaces the divergent step, the localize routine walks
backward to it — both the feed-tab and the wrong-navigation flavor reduce to "find the first step
whose post-state diverged." Least-to-most's OOD evidence and Agentless's phase-separation predict
this transfers where the hint did not.

> Key sources: Auto-Diagnose (ICSE'26), FALAT (2606.00765), Agentless (2407.01489), least-to-most
> (2205.10625), AgentDebug (2509.25370), Large Language Monkeys (2407.21787), CYCLE (2403.18746),
> the hashline edit-format result, APR patch-overfitting (2506.03283), resampling limits (2411.17501).
