# The skill system — understudy's Plane A core

The deterministic gate (Plane B) is understudy's trust core. This doc is about the OTHER half:
the **skill** — the Plane A artifact that makes a swappable, cheap LLM produce gate-passing work.
The skill is the part that is *learnable*, and the gate is exactly the *verifier* needed to learn
it. This reframes the harness: **the skill document is a first-class, version-controlled core
artifact**, not an inlined prompt.

## The reframe

| | Plane B (gate) | Plane A (skill) |
| --- | --- | --- |
| Role | verifier — scores an attempt deterministically (no LLM, INV-1) | the LLM's procedural knowledge for authoring/healing |
| Artifact | lints + re-run-green + `mustRetain` (`score()`) | `skills/heal.skill.md` (+ overlays) |
| Property | fixed, trusted, deterministic | improvable — hand-authored now, **learnable** later |

A measured result motivates this: on the hard root-cause break, weak models scored 0/5 under a
prompt that said *"Fix ONLY the test's locator"* (a symptom-fixing bias), and **3/5–5/5 under a
better, model-agnostic skill** (R1–R4), with no regression on the easy classes. The model didn't
change — the skill did. So the skill is where the leverage is, and it deserves to be a real
artifact with its own lifecycle.

## INV-1, extended to the meta level

The harness rule is "the LLM proposes, the deterministic gate disposes." Skill *learning* obeys
the same rule one level up: an optimizer LLM **proposes edits to the skill document**, and a
**deterministic validation gate accepts an edit only if it strictly improves a held-out score**.
The LLM never decides what a good skill is; the gate does. INV-1 is preserved — and made
recursive.

## base ⊕ overlay (mirrors core / adapter)

understudy already splits a project-agnostic `core/` from per-project `adapters/`. The skill
system mirrors it exactly:

```
skills/heal.skill.md             BASE — project-agnostic, OSS-clean, the shared core skill
adapters/<project>/heal.overlay.md   OVERLAY (optional) — that project's flows, control
                                     vocabulary, common root-causes; composed AFTER the base
effective skill = BASE ⊕ OVERLAY     (skills/load-skill.ts; HTML maintainer comments stripped)
```

- The **base** is learned/curated against the hermetic reference consumers' gates — generic
  procedural knowledge ("trace the flow; the failing line is often not the cause").
- An **overlay** is learned against ONE project's gate — its real break corpus teaches
  project-specific knowledge ("here the *Members* tab hides pending rows"). It is the per-project
  specialization seam, exactly where a new project onboards (one adapter = one overlay).
- **OSS boundary:** the base ships in `skills/` (public, no internal identifiers). A project
  overlay may carry specifics and can stay **private** (like the downstream consumer) — the same
  boundary the harness already enforces.

## Learning a skill against the gate (SkillOpt-style)

We adopt **microsoft/SkillOpt**: a text-space optimizer that trains a markdown skill for a FROZEN
model against a numeric verifier — no weight updates, zero inference overhead (the skill is just a
prompt prefix). It maps onto us with almost no impedance:

1. **Rollout** — run the heal loop on a batch of induced breaks under the current skill; capture
   each trajectory + its **gate score** (our `score()` is the reward, already built).
2. **Reflect** — an optimizer LLM reads scored rollouts (failures vs successes) and proposes
   **bounded** add/delete/replace edits to the skill doc.
3. **Validation gate** — accept an edit only if it strictly improves a **held-out** split score.
4. **Stability** — an edit budget per step (a textual "learning rate") + a rejected-edit buffer
   fed back as negative guidance.
5. **Output** — a new `heal.skill.md` (base) or `heal.overlay.md` (overlay), committed + diffable.

Key property for us: SkillOpt's headline is that **small/weak models gain the most**, and skills
learned on a strong model **transfer** to weak ones — exactly the cheap-swappable-model goal.
Training is heavyweight (offline, many rollouts); deployment is free. The break taxonomy
(name-rename / wrong-role / changed-text / exact-case / flow-wrong-step) is the task distribution,
split train / held-out.

## Staged path

- **Stage 0 — DONE.** Skill is a first-class artifact: `skills/heal.skill.md` (base v0 = R1–R4) +
  `skills/load-skill.ts` (base ⊕ overlay, comment-stripped) + conformance. The heal loop reads it.
- **Stage 1 — overlay seam.** Wire an adapter's `heal.overlay.md` end-to-end (the loader already
  composes it); author a reference overlay for a hermetic consumer.
- **Stage 2 — learn the base.** SkillOpt loop over the reference consumers' gate to learn the base
  skill; compare to hand-authored R1–R4 (experiment E1).
- **Stage 3 — learn an overlay.** Learn a per-project overlay against that project's gate; measure
  base⊕overlay vs base-only (E3).

## Landscape — adopt, borrow, or just cite

A research pass (recent verifier-guided text-artifact optimizers + GitHub maturity) places SkillOpt
in context. Caveat: several 2026 arXiv leads are very recent / single-source — treat the freshest
as leads to verify, not settled results.

**Adopt / take the dependency.** **SkillOpt** (microsoft/SkillOpt, MIT, v0.1.0 — real + pip, but a
~3-week-old API that will churn) is the only tool literally doing skill-doc optimization; start
there. Keep **DSPy** (stanfordnlp/dspy, ~35k★, MIT, very active) + **GEPA** (gepa-ai/gepa, MIT) as
the battle-tested fallback if SkillOpt's young API blocks us. Everything below is *borrow the
mechanism*, not take the dependency.

**Borrow the mechanism (highest-value grafts):**
- **SkillGrad** (arXiv 2605.27760) — independently invents *our* design: base + learned overlay
  against a binary deterministic gate, with contrastive *success*-trace learning and edit-routing
  to the right layer. Closest prior art; read before building. (single-source — verify.)
- **ACE — Agentic Context Engineering** (2510.04618, ace-agent/ace, Apache-2.0) — **non-destructive
  delta-merge** with per-bullet helpful/harmful counters; the named fix for skill *bloat/collapse*
  over many gate cycles. This is *how an overlay accretes* without degrading.
- **ASI — Agent Skill Induction** (2504.06821, COLM'25) — admit a skill only on a 3-axis gate:
  Correctness + **Skill-Usage** (the trajectory actually invokes it) + **Skill-Validity** (each
  action changes the env). Rejects *inert* rules — directly attacks our `vacuous no-edit` miss.
  (Our `score()` already rejects vacuous-no-edit, so we have the seed of this.)
- **SkillEvolver** (2605.10500) — score edits by a **fresh deployment agent** + a **leakage
  auditor** (anti-Goodhart for a fixed re-run gate). **SkillWeaver** (2504.07079) — cleanest
  published evidence that strong-authored skills lift a weaker executor (+54% WebArena), our anchor
  for the transfer experiment. **DGM** (2505.22954) — we are essentially *DGM-lite*: keep its
  archive + empirical test gate, drop the self-code-rewrite.

## Experiments (against the gate; fixture-level split)

**Split discipline (all experiments):** the 5 break classes are few, so define tasks at the
*fixture* level (many distinct fixtures per class on the hermetic consumer) and split **by
fixture**, never by class — a held-out fixture exercises a trained class on unseen surface.
Optimize on TRAIN; accept/report on HELD-OUT. Ranked by value: **e1 > e3 > e2 > e4 > e3b/e5**.

- **e1 — learned BASE vs hand-authored R1–R4 (proves the thesis).** Three arms: (A) old scaffold
  (the 0/5-weak baseline), (B) hand-authored R1–R4, (C) SkillOpt-learned base. Hypothesis: on weak
  models C ≥ B ≫ A; on strong models A≈B≈C (saturation). A strong result = *the gate can author the
  scaffold we wrote by hand*. Watch C overfitting TRAIN flow fixtures and regressing single-locator.
- **e3 — per-project OVERLAY: does base⊕overlay beat base-only (proves the architecture).** Freeze
  the e1-winning base; introduce a quirky second adapter; learn an **overlay only** against its
  gate. Two-sided metric: (1) project held-out success-rate; (2) a **BASE-regression gate** — re-run
  the base fixtures with the overlay composed in, reject any overlay that regresses the base.
- **e3b — base/overlay decoupling.** Independent (base-then-overlay) vs joint co-optimization on the
  e3 project. Small gap (≤~3pp) justifies separate optimization; large gap argues for joint search.
- **e2 — strong→weak transfer.** Learn the base with a strong author model vs the weak model itself;
  deploy both on each weak executor. Hypothesis: strong-authored ≥ self-authored on weak executors
  (SkillWeaver evidence). Ties to the cheap-tier default in HEAL-MODEL-DELTA.md.
- **e4 — component ablations.** Leave-one-out of {R1 root-cause-first, R2 few-shot, R3 reflection,
  R4 no-vacuous} on the two weak models that moved most. Hypothesis: R1 + R4 carry the flow lift
  (every miss was vacuous/symptom-fix). Tells us which rules a *learned* base must preserve.
- **e5 — anti-Goodhart / overlay-overfit stress.** Deliberately over-train an overlay (single
  fixture/class), then evaluate on held-out same-class fixtures + a **fresh executor** + a leakage
  audit. Operationalizes overfit detection as a standing acceptance gate for every overlay.

### e1 — first run + the mock-fidelity finding (Stage 2)

The optimizer is built (`scripts/skill-optimize.ts`): rollout → reflect → **validation-gate
(accept only on a strict held-out improvement)** → edit budget + rejected-edit buffer, with our
gate as the reward. Two methodology fixes fell out of the first runs:

1. **The rollout loop must be NEUTRAL.** An early version baked the R3/R4 reflection text ("…
   reconsider the *upstream* step, not the assertion") into the loop — which leaked the very
   root-cause guidance e1 is trying to learn into the *naive* arm. Fixed: the loop's only fixed
   mechanic is "you must make an edit"; ALL guidance now comes from the skill (system prompt).
2. **A MOCK gate is too easy for a reasoning executor on the flow discriminator.** With clean,
   simplified mock observations, `qwen3.6` (reasoning-on) root-causes the flow break from the test
   structure *regardless of prompt* — naive ≈ hand-authored ≈ learned ≈ 100% (noise-dominated).
   The learnable gap that R1–R4 closed (0/5 → 3–5/5) lives in the **real environment** (noisy live
   `ariaSnapshot`, `replace_in_spec` exact-match ergonomics, real test output), not the clean mock.

**Real-gate e1 (the follow-up — done).** The heal real-tools are now reusable
(`heal/real-tools.ts`, shared by a3 + the optimizer) and the optimizer supports `--gate=real`. On
the REAL gate, focused on the flow discriminator (qwen3.6, n=3):

- **naive = 0%** (0/3 — the old "fix only the locator" scaffold reliably fails to root-cause the
  real flow break),
- **hand-authored R1–R4 = 33%** (1/3 — the skill matters on the real gate, unlike the easy mock),
- the optimizer, using ONLY the gate as verifier, proposed an edit that scored **33%** held-out and
  the validation gate **ACCEPTED** it (it strictly beat naive's 0%) — lifting the weak model 0 → 33%
  in one epoch. The learned edit was an anti-no-op / inspect-harder rule ("ensure your replacement
  changes the locator's arguments — never leave it identical; if no match, inspect the surrounding
  structure"), NOT a rediscovery of R1's flow-tracing — a different, gate-rewarded path.

**What this shows (and doesn't).** *Demonstrated:* the deterministic gate can **teach** the skill —
the optimizer learned a gate-improving edit on the real gate, accepted only via the held-out
validation gate (INV-1 at the meta level). *Not yet resolved:* a clean RANKING of learned vs
hand-authored — at n=3 the flow break is a 3-coin-flip (the learned skill scored 33% when accepted
but 0% on a fresh re-eval), so a precise comparison needs higher n and — per §Risks — **multiple
flow fixtures** (we have one). That is the measurement-budget next step, not a mechanism gap.

### e1 refinement — multiple flow fixtures + fixture-level held-out

Added 3 flow fixtures of the SAME root-cause skill on different surfaces (`flow-feed-tab` = wrong
CLICK; `flow-nav-editor` / `flow-nav-settings` = wrong NAVIGATION), all RED-verified, with a
`--train`/`--held` split BY FIXTURE and a real-gate RED-precheck. Refined real-gate run (qwen3.6,
train = feed-tab + nav-editor, **held-out = nav-settings (a flavor variant)**, n=4):

| skill | held-out (nav-settings, n=4) |
| --- | --- |
| naive | 0% |
| learned (1 epoch) | 0% (candidate didn't beat naive → rejected) |
| hand-authored R1–R4 | **0%** |

**The finding the fixture-split was FOR.** All three score 0% on the navigation-flavor break —
including hand-authored R1–R4, which lifts the *feed-tab* flavor to 3/5. So **R1–R4 is
flavor-specific** (its prose + few-shot are click/tab-framed; they do not transfer to "the wrong
*goto*"), and qwen3.6 (smallest, ~3B active) cannot root-cause the nav flavor with any of these
skills; 1 epoch / n=4 was not enough for the optimizer to learn a nav-transferable one either. The
single-fixture e1 (feed-tab, 0→33%) was **optimistic precisely because it tested the same flavor it
targeted** — the multi-fixture held-out corrects that. Takeaways: (1) cross-flavor generalization is
a real, measurable gap (the split surfaced it); (2) a clean "learned > naive" demonstration needs
held-out fixtures the executor *can* solve with the right skill (more *feed-tab*-flavor variants) +
more epochs + more diverse training fixtures; (3) a stronger executor likely transfers better
(an e2 question). The mechanism (gate teaches skill) stands from the single-fixture run; *general*
skill induction across flavors is the open frontier.

## Fundamental-quality campaign (deep-research-synthesized plan)

Two deep-research passes (heal-quality; fixture-generation + generalization + eval) converged on a
root cause and a prioritized plan. The recurring bottleneck all session was **fixture scarcity**
(~1 hand-made fixture per class → can't split, high variance, can't measure generalization → it even
caused the no-headroom e1 mistake), plus **flavor-specific skills** that don't generalize.

**Keystone — break/fixture generator (`heal/generate-fixtures.ts`, scaffold built).** A fixture =
(base GREEN spec, break operator, params); `broken`/`gold`/`mustRetain`/marker are DERIVED
mechanically. The validator is our gate (F→P/P→P: RED-before + GREEN-after-gold) — novel generator,
textbook validator. Budget for a high discard rate (SWE-bench kept 2.5%) as a sign of health.
v1 covers reliably-RED substitution flow flavors (wrong-nav, wrong-click); extensible to
missing-step / wrong-order (rich on the multi-step create-journey) and locator-drift at scale.
**Honest constraint:** the hermetic Conduit app has a SMALL surface — true flow-discriminator
fixtures are intrinsically limited; a large diverse corpus needs the create-flow operators and/or a
richer reference app.

**Diversity > instances (the generalization rule).** Breadth of training flavors drives held-out
generalization; instances-per-task saturate (~64). One fixture/flavor is the Procgen "100-level"
overfit regime — exactly what we saw. → cap `--n`, spend budget on more distinct flavors.

**GEPA-style Pareto acceptance (planned optimizer change).** Replace single-winner acceptance
(`held_score > best`) with a Pareto frontier over per-FIXTURE scores so a learned skill can't
collapse to one flavor (directly copyable from `dspy.GEPA`). Pair with Ladder/reusable-holdout
discipline (the optimizer queries the val set thousands of times → it WILL overfit it otherwise).

**Valid eval (the fix for the 0%-ceiling mistake).** Admit a held-out fixture only with HEADROOM
(naive FAILS it AND some skill PASSES it — an IRT discrimination filter; floor/ceiling items carry
zero signal). Split BY FLAVOR, held-out a distinct flavor. Compare skills PAIRED on the same
fixtures (McNemar mid-p + Wilson CIs + clustered SEs by flavor + K resamples) — ~⅓ variance
reduction. Size n via the power formula to a target δ (≥~15pp); n≤10 is a coin-flip. **And use a
stronger weak executor (qwen3.5, 5/5 on feed-tab) where headroom exists across flavors — qwen3.6 has
a 0% ceiling on the nav flavor, so it can't show learning there regardless of skill.**

**Heal-loop quality (moves the actual root-cause metric).** See `docs/HEAL-QUALITY.md`: robust
edit-apply (DONE — removes the apply confound), then real failure-trace observation, grounded
tool-based localize, structured Reflexion, best-of-N (caveat: games the gate; tighten `score()`
first). These are what make the SKILL induce *generalizable* root-cause rather than a flavor pattern.

**Valid-eval stats (`heal/eval-stats.ts`, done).** Wilson CI per cell (a "0%" at n=4 is compatible
with a true ~49% — bare rates lie), Newcombe difference CI for our independent arms, McNemar mid-p
for true paired data. Every A/B is reported with intervals, not bare rates (research Part 3).

Status: robust edit-apply ✓ · **trace lever ✓ (nav-settings 0→50%)** · generator scaffold ✓ ·
**levers C+D ✓ (harness-enforced grounded localize; measuring)** · **valid-eval stats ✓**. Next:
interpret the C/D A/B (close nav-editor + attribute cleanly) → GEPA-Pareto acceptance → a headroom'd,
flavor-disjoint, paired e1 → best-of-N (after gate-tightening). Driven by experiment completions.

### Learning e1 (C/D + GEPA-Pareto) — the gate teaches a dominating skill; learned↔hand gap remains

Real-gate learning run (qwen3.6, **C/D localize ON**, GEPA-Pareto, train = `flow-nav-settings`,
held = [`flow-feed-tab`, `flow-nav-editor`], n=3, 2 epochs):

```
[init]    naive    per-fixture = [feed-tab 33%, nav-editor 0%]
[epoch 1] candidate = [100%, 0%]  => ACCEPT (Pareto-dominates naive)
[epoch 2] candidate = [33%, 0%]   => reject (Pareto-dominated)
final (fresh re-eval): naive 50% · LEARNED 50% · hand-authored 100%
```

- **Demonstrated:** the deterministic gate + GEPA-Pareto **learns a skill that DOMINATES naive**
  (feed-tab 33→100%); the Pareto rule accepted the dominating candidate and rejected the dominated
  one. The learning mechanism works on the *real* gate with C/D.
- **Not closed:** the learned skill did NOT reach hand-authored on the **hard** held flavor
  (nav-editor: **learned 0% vs hand 100%**). 2 epochs from naive didn't discover the nav-editor
  root-cause content hand-authored already has — i.e. the **C/D harness helps but skill CONTENT
  still matters** (naive+C/D = 0%, hand+C/D = 100% on nav-editor). The aggregate "naive 50% ≈
  learned 50%" is dominated by **n=3 noise** (naive init 16.5% → final 50%), so "learned > naive" is
  visible only via the epoch domination, not the noisy aggregate.
- **Frontier:** the learned↔hand gap on the hard flavor is the open problem. Obvious levers:
  more epochs, a stronger/again-failing train signal, higher n, and more fixtures. Mechanism ✓;
  reaching hand-level *learned* content on the hard flavor is the next push.

### Learning e1, round 2 — higher-n · multi-epoch + a localize-AWARE optimizer CLOSES the gap

Same split (qwen3.6, C/D localize ON, GEPA-Pareto, train = `flow-nav-settings`, held =
[`flow-feed-tab`, `flow-nav-editor`]) with the three frontier levers turned up at once — **n 3→5,
epochs 2→5, and a localize-AWARE optimizer.** `propose()` now tells the optimizer the healer runs
under the grounded-localize harness + the failure page-state evidence, so it can write skill text
that EXPLOITS that evidence — the exact framing the hand-authored skill has and a *blind* optimizer
cannot invent. The gate still disposes (held-out Pareto): INV-1 at the meta level is intact.

```
[init]    naive    per-fixture = [feed-tab 60%, nav-editor 0%]
[epoch 1] candidate = [100%, 40%] => ACCEPT      nav-editor 0→40
[epoch 2] candidate = [100%, 60%] => ACCEPT              →60
[epoch 3] candidate = [100%, 80%] => ACCEPT              →80
[epoch 5] candidate = [100%, 20%] => reject (Pareto-dominated)
deployed best-aggregate = [feed-tab 100%, nav-editor 80%]
final (fresh n=10/skill): naive 40% · LEARNED 90% · hand-authored 80%
```

- **Gap CLOSED.** Fresh held-out comparison: **LEARNED 90% [60–98%] vs naive 40% [17–69%]**
  (Newcombe Δ=+50pp [+8,+75], **significant**) and **LEARNED 90% vs hand 80%** (Δ=+10pp [−24,+42],
  **n.s. — learned now TIES hand**). On the hard flavor specifically: learned **nav-editor 0%
  (round 1) → 80%** (Δ=+80pp [+19,+96], significant), climbing monotonically per accepted epoch
  (0→40→60→80) — the optimizer learned a *better* root-cause framing at each step.
- **Why it closed — the learned skill TEXT.** The deployed skill (the optimizer authored it) reads
  *"The failing assertion is a symptom, not the bug … identify the step that caused the divergence,
  and fix that step. Never touch the assertion"* and *"trace backward from the failing assertion to
  the first test step that produced the wrong page state."* That is the hand-authored R1–R4 framing,
  *learned*. Round 1's blind optimizer could not write it (→ learned 0%); making the optimizer
  localize-aware is what let the gate teach it (→ learned 80%). The gate authored the scaffold we
  wrote by hand — the thesis of this whole stage.
- **Honest confound:** three levers moved together (n, epochs, optimizer-awareness). The
  optimizer-awareness is the plausibly-dominant driver (it enables the framing the round-1 run
  lacked despite the budget), but a clean factorial (budget-only vs +awareness) is the follow-up.
  hand dipped to 80% here (vs 100% earlier under C/D) = n=5 sampling noise; learned ties it either
  way. n=10 aggregate CIs are still wide — the DIRECTION (learned ≥ hand ≫ naive; nav-editor closed)
  is the result; a precise ranking needs higher n + paired McNemar.
- **Factorial (the confound resolved):** a `--blind-optimizer` control re-ran round 2 at the SAME
  budget (n=5, 5 epochs, rollout-localize ON) but with the optimizer blind (no awareness note). It
  learned **nothing** over naive (LEARNED agg 50% = naive 50%; nav-editor 0/5, every epoch 0%).

  | | blind opt. | aware opt. |
  | --- | :---: | :---: |
  | low budget (2ep,n3) | nav-editor 0% (r1) | — |
  | high budget (5ep,n5) | nav-editor **0%** (◆) | nav-editor **80%** (r2) |

  Budget alone moved the hard flavor 0→0 (Δ=+0pp [−43,+43]); **awareness at fixed budget moved it
  0→80 (Δ=+80pp [+19,+96], significant).** So the closed gap is the **awareness SIGNAL, not extra
  search** — direct evidence for the campaign spine (structure of observation > brute compute for
  upstream root-causing). The aggregate +40pp [0,+68] is n.s. (feed-tab saturates both arms); the
  per-flavor nav-editor contrast is the clean, significant read. Limits: two runs, n≤10.

## Risks + the v0 invariants they imply

The design is well-founded; its biggest under-specified risk is **base/overlay precedence +
non-monotone composition** — no model arbitrates skill conflicts reliably (IHEval: stating the
priority order explicitly does not even help). Pitfalls → mitigations:

| Pitfall | Mitigation (built into v0) |
| --- | --- |
| Overlay overfits one project | optimize/select on a **held-out fixture split**; prune over-specific rules |
| Base/overlay **conflict** | **explicit precedence by position** — overlay appended AFTER base (recency wins); detect contradictory directives at compose time |
| **Catastrophic forgetting** of the base | **freeze the base, learn only overlays** (clean for prompts — base markdown is immutable) |
| **Non-monotone** composition (overlay hurts base tasks) | **held-out BASE-regression gate**: re-run base tasks with the overlay in, reject on regression |
| Reward hacking / **leakage / Goodhart** | **separate the optimization split from the acceptance gate**; fresh-executor + leakage audit; cheating edits are already rejected by post-heal-lint |
| Optimizer-model strength | small models are weak *optimizers* — use a strong model to PROPOSE skill edits even when the DEPLOYED model is weak |
| Training cost | offline + periodic; the artifact is free at inference. Bound rollouts; log what was sampled |

**Three invariants to bake in regardless of experiment order:**
1. **Freeze the base; learn only overlays** — the prompt-clean catastrophic-forgetting fix.
2. **Held-out BASE-regression gate on every overlay** — turns "don't break the base" from hope into
   a measured reject criterion (a natural extension of the gate we already have).
3. **Separate the optimization split from the acceptance gate + a usage/effect check** — rejects
   inert / vacuous overlay rules (ASI's Skill-Usage/Validity; our `score()` already rejects the
   vacuous-no-edit case).

> Reading that justifies our strict deterministic gate: "Prompt Optimization Is a Coin Flip"
> (arXiv 2604.14585) found **~49% of prompt-optimization runs fell *below* zero-shot** — PO helps
> reliably only with an exploitable, checkable output structure. Our gate is exactly that guard.
