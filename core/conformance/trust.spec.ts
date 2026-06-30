/**
 * Trust-machinery CONFORMANCE / mutation proofs — B10 host guard, B11
 * redaction/leak-check, and the L10 no-mechanism-in-core lint. Pure-unit (no
 * browser, no network), so the harness's server-like boundaries are VERIFIED, not
 * asserted.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { assertHostAllowed, assertExplorationLocal } from '../host-guard'
import { buildDenylist, scanForLeaks, redact } from '../redact-trace'

test.describe('conformance: B10 host-allowlist guard (mutation-proven)', () => {
  const allow = ['app.dev.example.com', 'localhost:4173'] as const

  test('an allow-listed host passes', () => {
    expect(() =>
      assertHostAllowed('https://app.dev.example.com/home', allow),
    ).not.toThrow()
  })

  test('a non-allow-listed (prod-like) host is cannot-run RED', () => {
    expect(() =>
      assertHostAllowed('https://app.prod.example.com/', allow),
    ).toThrow(/cannot-run.*not allow-listed/s)
  })

  test('exploration rail: localhost passes, a live host is RED', () => {
    expect(() => assertExplorationLocal('http://localhost:5174/home')).not.toThrow()
    expect(() =>
      assertExplorationLocal('https://app.dev.example.com/'),
    ).toThrow(/exploration must run on mock\/local/)
  })
})

test.describe('conformance: B11 redaction + pre-upload leak-check (mutation-proven)', () => {
  // Generic + consumer-free: an adapter supplies its env names + key shapes.
  const env = {
    APP_PASSWORD: 'p4ss-secret-xyz',
    APP_API_TOKEN: 'tok_live_abcdef123456',
  } as NodeJS.ProcessEnv
  const dl = buildDenylist({
    env,
    envNames: ['APP_PASSWORD', 'APP_API_TOKEN'],
    extraPatterns: [/tok_[A-Za-z0-9]{6,}/g], // a project-specific key shape
  })
  const dirtyTrace =
    'GET /api/v1/items\n' +
    'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl\n' +
    '{"password":"p4ss-secret-xyz","key":"tok_live_abcdef123456"}'

  test('leak-check FAILS on a trace carrying a secret value / token / auth header', () => {
    expect(scanForLeaks(dirtyTrace, dl).length).toBeGreaterThan(0)
  })

  test('leak-check PASSES a clean trace', () => {
    expect(scanForLeaks('GET /api/v1/items 200 OK', dl)).toEqual([])
  })

  test('redact scrubs the secret value, the token shape, and the header value', () => {
    const red = redact(dirtyTrace, dl)
    expect(red).not.toContain('p4ss-secret-xyz')
    expect(red).not.toContain('tok_live_abcdef123456')
    expect(red).toContain('***REDACTED***')
  })
})

test.describe('conformance: L10 — core auth lifecycle is mechanism-free', () => {
  test('core/auth-prefill.ts has NO non-comment mechanism identifier', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'core/auth-prefill.ts'),
      'utf-8',
    )
    const codeLines = src.split('\n').filter((l) => {
      const t = l.trim()
      return t !== '' && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    const offenders = codeLines.filter((l) =>
      /sessionstorage|oidc|bearer|keycloak/i.test(l),
    )
    expect(offenders).toEqual([])
  })
})
