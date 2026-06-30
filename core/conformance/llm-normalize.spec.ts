/**
 * llm/normalize conformance — tool-call normalization across heterogeneous providers.
 * Deterministic + network-free. Proves: structured tool_calls win and are parsed safely;
 * malformed/empty args are coerced (never thrown); and — the reasoning-model RESCUE — when
 * tool_calls is empty, inline `<tool_call>` / `<function=>` / fenced-JSON calls in
 * content OR reasoning are recovered, while plain prose NEVER fabricates a call.
 */
import { test, expect } from '@playwright/test'
import { extractToolCalls, parseToolArgs, stripThinkTags } from '../../llm/normalize'

test.describe('conformance: parseToolArgs coerces heterogeneous argument payloads', () => {
  test('object passes through; JSON string parses; "" → {}; junk → {_raw}; number → {}', () => {
    expect(parseToolArgs({ a: 1 })).toEqual({ a: 1 })
    expect(parseToolArgs('{"city":"Seoul"}')).toEqual({ city: 'Seoul' })
    expect(parseToolArgs('')).toEqual({}) // some providers send "" for a no-arg tool
    expect(parseToolArgs('   ')).toEqual({})
    expect(parseToolArgs('not json')).toEqual({ _raw: 'not json' })
    expect(parseToolArgs(42)).toEqual({})
    expect(parseToolArgs(undefined)).toEqual({})
  })
})

test.describe('conformance: extractToolCalls — structured path', () => {
  test('structured tool_calls are returned with parsed args and ids', () => {
    const calls = extractToolCalls({
      tool_calls: [
        { id: 'x1', function: { name: 'run_test', arguments: '{}' } },
        { function: { name: 'replace_in_spec', arguments: '{"old":"a","replacement":"b"}' } },
      ],
    })
    expect(calls).toEqual([
      { id: 'x1', name: 'run_test', args: {} },
      { id: 'call_1', name: 'replace_in_spec', args: { old: 'a', replacement: 'b' } },
    ])
  })

  test('an empty-string argument on a structured call is coerced to {} (no throw)', () => {
    const calls = extractToolCalls({ tool_calls: [{ id: 'a', function: { name: 'run_test', arguments: '' } }] })
    expect(calls).toEqual([{ id: 'a', name: 'run_test', args: {} }])
  })

  test('structured calls WIN — inline markup in content is ignored when tool_calls present', () => {
    const calls = extractToolCalls({
      content: '<tool_call>{"name":"ghost","arguments":{}}</tool_call>',
      tool_calls: [{ id: 'a', function: { name: 'run_test', arguments: '{}' } }],
    })
    expect(calls.map((c) => c.name)).toEqual(['run_test'])
  })
})

test.describe('conformance: extractToolCalls — reasoning-model RESCUE (empty tool_calls)', () => {
  test('rescues a <tool_call>{json}</tool_call> emitted INLINE in content', () => {
    const calls = extractToolCalls({
      content: 'let me check\n<tool_call>{"name":"get_accessibility","arguments":{"path":"/"}}</tool_call>',
      tool_calls: [],
    })
    expect(calls).toEqual([{ id: 'inline_0', name: 'get_accessibility', args: { path: '/' } }])
  })

  test('rescues a tool call lost into REASONING (the Qwen3.x / vLLM #39056 failure mode)', () => {
    // The reasoning parser swallowed the call before the tool parser saw it → tool_calls
    // empty, but the markup is still in the reasoning text. We recover it.
    const calls = extractToolCalls({
      content: '',
      reasoning: 'I will call the tool. <tool_call>{"name":"run_test","arguments":{}}</tool_call>',
      tool_calls: [],
    })
    expect(calls).toEqual([{ id: 'inline_0', name: 'run_test', args: {} }])
  })

  test('rescues a <function=NAME>{json}</function> (llama/Hermes style)', () => {
    const calls = extractToolCalls({
      content: '<function=replace_in_spec>{"old":"x","replacement":"y"}</function>',
      tool_calls: [],
    })
    expect(calls).toEqual([{ id: 'inline_0', name: 'replace_in_spec', args: { old: 'x', replacement: 'y' } }])
  })

  test('rescues a fenced ```json {name,arguments}``` block as a last resort', () => {
    const calls = extractToolCalls({
      content: '```json\n{"name":"run_test","arguments":{}}\n```',
      tool_calls: [],
    })
    expect(calls).toEqual([{ id: 'inline_0', name: 'run_test', args: {} }])
  })

  test('content as an array of text parts is searched too', () => {
    const calls = extractToolCalls({
      content: [{ type: 'text', text: '<tool_call>{"name":"run_test","arguments":{}}</tool_call>' }],
      tool_calls: [],
    })
    expect(calls.map((c) => c.name)).toEqual(['run_test'])
  })

  test('NEVER fabricates — plain prose / a normal JSON answer yields no calls', () => {
    expect(extractToolCalls({ content: 'The locator should be Global Feed.', tool_calls: [] })).toEqual([])
    expect(extractToolCalls({ content: 'here is data: ```json\n{"city":"Seoul"}\n```', tool_calls: [] })).toEqual([])
    expect(extractToolCalls({})).toEqual([])
  })
})

test.describe('conformance: stripThinkTags — on-prem <think> leak cleanup', () => {
  test('removes closed <think> blocks and trims', () => {
    expect(stripThinkTags('<think>let me reason\nabout this</think>The answer is X')).toBe('The answer is X')
    expect(stripThinkTags('a<think>x</think>b<think>y</think>c')).toBe('abc')
  })

  test('removes a dangling unclosed <think> (truncated output)', () => {
    expect(stripThinkTags('answer<think>reasoning that got cut off')).toBe('answer')
  })

  test('leaves think-free content unchanged (just trimmed)', () => {
    expect(stripThinkTags('  getByRole(...)  ')).toBe('getByRole(...)')
  })

  test('a <tool_call> emitted INSIDE <think> is STILL rescued (strip never precedes extraction)', () => {
    // The on-prem worst case: vLLM leaks the call into the reasoning region. extractToolCalls
    // scans the raw message, so the call is recovered even though stripThinkTags would erase it.
    const msg = {
      content: '<think>I will fix it <tool_call>{"name":"run_test","arguments":{}}</tool_call></think>',
      tool_calls: [],
    }
    expect(extractToolCalls(msg)).toEqual([{ id: 'inline_0', name: 'run_test', args: {} }])
    // And the human-facing content, if cleaned, would be empty — proving they are independent.
    expect(stripThinkTags(msg.content)).toBe('')
  })
})
