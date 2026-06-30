/**
 * llm/reasoning conformance — per-family reasoning control (the fix for the real
 * "mimo unusable" pathology: reasoning-on models burn the max_tokens budget on hidden
 * reasoning and return null content / no tool call). Deterministic + pure. Proves family
 * classification and that `thinking:false` (the default) emits the correct disable payload
 * per family, including the Qwen3 DUAL payload that covers vLLM + non-vLLM backends.
 */
import { test, expect } from '@playwright/test'
import { identifyFamily, reasoningOverride } from '../../llm/reasoning'

test.describe('conformance: identifyFamily (case-insensitive prefix match)', () => {
  test('classifies the known families and falls through to other', () => {
    expect(identifyFamily('xiaomi/mimo-v2.5')).toBe('mimo')
    expect(identifyFamily('MIMO-v2-flash')).toBe('mimo')
    expect(identifyFamily('minimax/minimax-m3')).toBe('minimax')
    expect(identifyFamily('x-ai/grok-4.1-fast')).toBe('grok')
    expect(identifyFamily('z-ai/glm-5-turbo')).toBe('glm')
    expect(identifyFamily('qwen3.5-122b')).toBe('qwen')
    expect(identifyFamily('qwen/qwen3.6-plus')).toBe('qwen')
    expect(identifyFamily('deepseek/deepseek-v4-flash')).toBe('other')
    expect(identifyFamily('anthropic/claude-opus-4-8')).toBe('other')
    expect(identifyFamily('')).toBe('other')
  })
})

test.describe('conformance: reasoningOverride disables thinking by default (thinking=false)', () => {
  test('mimo / minimax / glm → reasoning.enabled=false', () => {
    expect(reasoningOverride('xiaomi/mimo-v2.5')).toEqual({ reasoning: { enabled: false } })
    expect(reasoningOverride('minimax/minimax-m3')).toEqual({ reasoning: { enabled: false } })
    expect(reasoningOverride('z-ai/glm-5-turbo')).toEqual({ reasoning: { enabled: false } })
  })

  test('grok → reasoning.effort="none"', () => {
    expect(reasoningOverride('x-ai/grok-4.1-fast')).toEqual({ reasoning: { effort: 'none' } })
  })

  test('qwen → DUAL payload (vLLM enable_thinking AND OpenRouter reasoning.enabled)', () => {
    expect(reasoningOverride('qwen/qwen3.6-plus')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
      reasoning: { enabled: false },
    })
  })

  test('unknown family → null (no override needed)', () => {
    expect(reasoningOverride('deepseek/deepseek-v4-flash')).toBeNull()
    expect(reasoningOverride('openai/gpt-x')).toBeNull()
  })
})

test.describe('conformance: reasoningOverride with thinking=true', () => {
  test('only GLM needs an explicit ENABLE; thinking-on-by-default families return null', () => {
    expect(reasoningOverride('z-ai/glm-5-turbo', true)).toEqual({ reasoning: { enabled: true } })
    expect(reasoningOverride('xiaomi/mimo-v2.5', true)).toBeNull()
    expect(reasoningOverride('minimax/minimax-m3', true)).toBeNull()
    expect(reasoningOverride('x-ai/grok-4.1-fast', true)).toBeNull()
    expect(reasoningOverride('qwen/qwen3.6-plus', true)).toBeNull()
    expect(reasoningOverride('deepseek/deepseek-v4-flash', true)).toBeNull()
  })
})
