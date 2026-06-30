# Making reasoning / cheap models actually usable

Why `xiaomi/mimo-v2.5` came out "inconclusive" in the A3 heal measurement
(`docs/HEAL-MODEL-DELTA.md`), what the investigation actually found, and the fixes now in
`llm/`. The primary root cause is **reasoning-on-by-default**, with provider routing and
tool-call format as secondary contributors. This generalizes to the Grok / GLM / Qwen3
reasoning-model families.

## Symptom

In A3, mimo intermittently produced `no edit (vacuous)` outcomes and "stalls," so its heal
numbers were recorded as confounded. Open question: is mimo *incapable*, or *mis-configured*?

## Primary root cause — reasoning ON by default (REPRODUCED)

Many reasoning models default to thinking ON. Under a finite `max_tokens` budget that is
catastrophic for deterministic, tool-driven work: the model spends the budget on **hidden
reasoning**, hits the length limit, and returns **null content and no tool call** — which is
indistinguishable from a "vacuous no-edit" or a "stall."

Reproduced in this repo against the live API (`xiaomi/mimo-v2.5`, `max_tokens=256`):

| request | finish_reason | reasoning tokens | content / tool_calls |
| --- | --- | ---: | --- |
| content, reasoning **ON** (default) | `length` | 277 | content = **null** |
| tool call, reasoning **ON** (default) | `length` | 255 | tool_calls = **null** |
| content, reasoning **OFF** | `stop` | 0 | correct answer (15 tok) |
| tool call, reasoning **OFF** | `tool_calls` | 0 | clean tool call, every run |

Disabling reasoning removes the pathology entirely (0 reasoning tokens, deterministic clean
output). So mimo is fully capable — it was being run thinking-on.

### Fix — per-family reasoning control (`llm/reasoning.ts`)

The disable switch differs by family. `reasoningOverride(modelId, thinking=false)` returns the
request-body fragment, merged at the top level of the OpenRouter chat/completions body:

| family | prefixes | disable payload (`thinking:false`) |
| --- | --- | --- |
| grok | `x-ai/grok-` | `{"reasoning":{"effort":"none"}}` |
| mimo | `xiaomi/`, `mimo` | `{"reasoning":{"enabled":false}}` |
| minimax | `minimax/`, `minimax` | `{"reasoning":{"enabled":false}}` |
| glm | `z-ai/`, `glm` | `{"reasoning":{"enabled":false}}` |
| qwen | `qwen3`, `qwen/qwen3` | `{"chat_template_kwargs":{"enable_thinking":false},"reasoning":{"enabled":false}}` |
| other | — | `null` (no override) |

Qwen3 needs the **dual** payload: vLLM backends honor `chat_template_kwargs.enable_thinking`,
non-vLLM OpenRouter providers honor `reasoning.enabled`; each ignores the key it doesn't
recognize, so the pair disables thinking across heterogeneous serving backends. (Qwen3 reasoning
models are documented to lose tool calls into the `<think>` region and to run away on output —
vLLM #39056 — so a single-backend payload is not enough.)

`OpenRouterProvider` applies this automatically with `thinking` defaulting to **false** —
cheap, fast, predictable, and immune to the budget-starvation trap. Opt back in per call with
`route:{ thinking:true }` plus a generous `openRouter.maxTokens`.

**Reasoning needs token headroom (the deeper lesson).** The null-content pathology was not
"reasoning is bad" — it was reasoning-ON colliding with a *tight* `max_tokens` (the budget was
spent on hidden reasoning before any answer emerged). Measured on the root-cause flow heal:
mimo scores **2/5 reasoning-off (1K budget)** but **5/5 reasoning-on (16K budget)** — full
recovery to deepseek's level, because root-causing an *upstream* cause is exactly what the
deliberation buys. So choose the mode per task: reasoning-OFF for cheap single-locator heals;
reasoning-ON **with a generous budget** for hard root-cause heals; never reasoning-ON under a
tight budget. A3 exposes both via `--thinking --max-tokens`.

## Secondary — provider routing

- **`require_parameters: true`** (always set): a `tools` request must never route to a provider
  that silently ignores `tools` and returns empty `tool_calls`.
- **Prefer-with-fallback, not a rigid pin.** A3 originally hard-pinned
  `provider:{order:['xiaomi/fp8'], allow_fallbacks:false}` — a transient stall on that one
  provider had no escape, even though mimo also has a second tool-capable provider
  (DigitalOcean). `llm/openrouter.ts` treats a preferred provider as `order:[provider]` with
  `allow_fallbacks:true`, so a stalling provider falls over to another tool-capable provider for
  the **same model** (verified: a forced request fell over to DigitalOcean).
- **Circuit breaker** (`llm/resilient.ts`): a genuinely dead provider is tried, tripped, then
  skipped for the rest of the run instead of being re-hammered every attempt.

## Defensive — tool-call normalization (`llm/normalize.ts`)

For the cases where format-loss is real (reasoning models / serving stacks that still leak the
call into text even with thinking off): when `tool_calls` is empty, rescue inline
`<tool_call>`/`<function=>`/fenced-JSON calls from content **or** reasoning, and coerce `""` /
malformed args to `{}`. It **never fabricates** a call from plain prose. mimo doesn't need this
through OpenRouter today; it is the generalization that keeps the Qwen3.x class usable.

### On-prem `<think>` leak (Qwen3, vLLM-served)

On OpenRouter, the providers we tested (atlas-cloud, alibaba, …) separate reasoning into a
dedicated `reasoning` field, so `content` is clean — verified: through this harness both
`qwen3.6-35b-a3b` and `qwen3.5-122b-a10b` emit clean structured `tool_calls` and heal a
single-locator break in 4 turns, no leak. But **on-prem vLLM** leaks the chain-of-thought into
`content` as literal `<think>` tags (vLLM #39056), and can lose a tool call into that region.
So `normalize.ts` exports **`stripThinkTags`** (closed blocks + a dangling unclosed `<think>`),
and `OpenRouterProvider` cleans the returned **`content`** with it — while tool-call extraction
keeps scanning the **raw** message, so a `<tool_call>` *inside* `<think>` is still rescued (strip
must never precede extraction). This mirrors the prior-production handling for this model family.

> Note: a model emitting clean `tool_calls` is a *format* property; whether it picks the right
> fix is *capability*. qwen3.6/3.5 pass the format bar here but score 0/5 on the root-cause flow
> heal (they fix the visible failing locator, not the upstream cause) — see
> docs/HEAL-MODEL-DELTA.md.

## Measurement vs product

- **Product / heal:** `route:{ requireParameters:true, pin:false, thinking:false }` + a
  multi-model candidate list → robust to provider stalls, reasoning-starvation, and format drift.
- **Per-provider measurement:** `route:{ pin:true }` reproduces a rigid pin on purpose, but pair
  it with the breaker + bounded timeout and treat a stall as an explicit **infra** outcome, never
  silently as a `vacuous`/capability miss (the original confound). A3 defaults to the product
  routing per model — which is what makes mimo measurable.

## References

- OpenRouter — reasoning tokens / `reasoning` control:
  <https://openrouter.ai/docs/use-cases/reasoning-tokens>
- OpenRouter — provider routing (`require_parameters`, `order` + `allow_fallbacks`):
  <https://openrouter.ai/docs/guides/routing/provider-selection>
- OpenRouter — tool & function calling: <https://openrouter.ai/docs/guides/features/tool-calling>
- Qwen — vLLM deployment / `enable_thinking`: <https://qwen.readthedocs.io/en/latest/deployment/vllm.html>
- vLLM #39056 — Qwen3 loses tool calls emitted inside `<think>`:
  <https://github.com/vllm-project/vllm/issues/39056>
- mlx-lm #1293 — tool-parser misses Qwen3.5/3.6 chat templates:
  <https://github.com/ml-explore/mlx-lm/issues/1293>
- Roo-Code #6630 — Qwen3 Coder raw-text thinking/tool calls via OpenRouter:
  <https://github.com/RooCodeInc/Roo-Code/issues/6630>
