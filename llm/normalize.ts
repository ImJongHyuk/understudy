/**
 * Tool-call normalization across heterogeneous providers (the "LiteLLM-like" layer,
 * scoped to what we actually need). Two real-world failure modes this defends against
 * (reference-grounded — see docs/PROVIDER-ROUTING-LESSONS.md):
 *
 *  1. Malformed arguments — some providers send `""` (empty string) for a no-arg tool, or
 *     non-JSON argument text. We coerce to `{}` / `{_raw}` instead of throwing.
 *  2. Inline / lost tool calls — reasoning models (Qwen3.5/3.6 class) sometimes emit the
 *     tool call as `<tool_call>{json}</tool_call>` text INSIDE the reasoning region, where
 *     the upstream reasoning parser strips it before the tool parser runs, leaving an EMPTY
 *     `tool_calls` field that looks like a vacuous no-edit. When `tool_calls` is empty we
 *     RESCUE such calls from content/reasoning text. We NEVER fabricate: with no structured
 *     calls and no inline markup, we return [].
 */
import type { ToolCall } from './types'

/**
 * Strip `<think>...</think>` chain-of-thought blocks from text (on-prem hardening).
 *
 * OpenRouter providers separate reasoning into a dedicated `reasoning` field, so their
 * `content` is clean. But on-prem vLLM-served reasoning models (Qwen3 class) LEAK the
 * chain-of-thought into `content` as literal `<think>` tags even with thinking disabled —
 * the case vLLM #39056 documents and prior production handles with a strip. Removes closed
 * blocks and a dangling unclosed `<think>` (truncated output).
 *
 * IMPORTANT: tool-call extraction scans the RAW message, NOT the stripped content, so a
 * `<tool_call>` emitted *inside* a `<think>` block is still rescued — only the human-facing
 * `content` field is cleaned. Never strip before `extractToolCalls`.
 */
export function stripThinkTags(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim()
}

/** Coerce a tool-call arguments payload (object | JSON string | "" | junk) to an object. */
export function parseToolArgs(a: unknown): Record<string, unknown> {
  if (a && typeof a === 'object') return a as Record<string, unknown>
  if (typeof a === 'string') {
    const s = a.trim()
    if (s === '') return {} // some providers send "" for a no-argument tool
    const v = tryJson(s)
    return v ?? { _raw: s }
  }
  return {}
}

interface RawMsg {
  content?: unknown
  reasoning?: unknown
  reasoning_content?: unknown
  tool_calls?: unknown
}

/** Extract normalized tool calls from a raw assistant message. Structured `tool_calls`
 * win; otherwise rescue inline markup from content + reasoning text. */
export function extractToolCalls(msg: RawMsg): ToolCall[] {
  const structured = Array.isArray(msg?.tool_calls) ? (msg.tool_calls as Array<Record<string, unknown>>) : []
  if (structured.length > 0) {
    return structured.map((c, i) => {
      const fn = (c?.function ?? {}) as { name?: string; arguments?: unknown }
      return { id: (c?.id as string) ?? `call_${i}`, name: fn.name ?? '', args: parseToolArgs(fn.arguments) }
    })
  }
  const text = [textOf(msg?.content), textOf(msg?.reasoning), textOf(msg?.reasoning_content)]
    .filter(Boolean)
    .join('\n')
  return text ? scanInlineToolCalls(text) : []
}

/** Content may be a string or an array of parts ({type:'text', text}). */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v.map((p) => (typeof p === 'string' ? p : ((p as { text?: string })?.text ?? ''))).join('')
  }
  return ''
}

const TAG_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi
const FN_RE = /<function\s*=\s*([^>\s]+)\s*>\s*([\s\S]*?)<\/function>/gi
const FENCE_RE = /```(?:json|tool_call|xml)?\s*([\s\S]*?)```/gi

function scanInlineToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = []
  const push = (name: string, rawArgs: unknown): void => {
    if (name) out.push({ id: `inline_${out.length}`, name, args: parseToolArgs(rawArgs) })
  }
  // 1) Qwen/Hermes XML: <tool_call>{"name":..,"arguments":..}</tool_call>
  for (const m of text.matchAll(TAG_RE)) {
    const obj = tryJson(m[1])
    if (obj) push(String(obj.name ?? obj.tool ?? ''), obj.arguments ?? obj.parameters ?? obj.args)
  }
  // 2) llama/Hermes function tag: <function=NAME>{json}</function>
  for (const m of text.matchAll(FN_RE)) push(m[1], m[2])
  // 3) Last resort: a fenced JSON block whose object looks like a call. Only when nothing
  //    else matched, so a normal ```json ...``` answer isn't misread as a tool call.
  if (out.length === 0) {
    for (const m of text.matchAll(FENCE_RE)) {
      const obj = tryJson(m[1])
      if (obj && typeof obj.name === 'string') push(obj.name, obj.arguments ?? obj.parameters ?? obj.args)
    }
  }
  return out
}

function tryJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s.trim())
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
