/**
 * heal/probe conformance — the grounding-probe arg helpers. parseClicks must coerce + bound the
 * model's click list (a runaway chain would hang the probe); nameMatcher must match case-insensitive
 * SUBSTRING yet escape regex specials (a name like "Order #1 (new)" must match literally).
 */
import { test, expect } from '@playwright/test'
import { parseClicks, nameMatcher, MAX_PROBE_CLICKS } from '../../heal/probe'

test('parseClicks: trims, drops empties, ignores non-arrays', () => {
  expect(parseClicks(['Show All', '', '  Archived  ', 0])).toEqual(['Show All', 'Archived'])
  expect(parseClicks('Show All')).toEqual([]) // a bare string is not a click list
  expect(parseClicks(undefined)).toEqual([])
  expect(parseClicks(null)).toEqual([])
})

test('parseClicks: bounded to MAX_PROBE_CLICKS', () => {
  const many = Array.from({ length: 12 }, (_, i) => `tab${i}`)
  expect(parseClicks(many)).toHaveLength(MAX_PROBE_CLICKS)
})

test('nameMatcher: case-insensitive substring', () => {
  const m = nameMatcher('Show All')
  expect(m.test('Show All')).toBe(true)
  expect(m.test('show all')).toBe(true)
  expect(m.test('the Show All toggle')).toBe(true)
  expect(m.test('Archived')).toBe(false)
})

test('nameMatcher: regex specials are escaped (matched literally, not as a pattern)', () => {
  const m = nameMatcher('Order #1 (new)')
  expect(m.test('Order #1 (new)')).toBe(true)
  expect(m.test('Order 1 new')).toBe(false) // the parens/# are literal, not regex
  // a name of just "a+" must not match "aaaa"
  expect(nameMatcher('a+').test('aaaa')).toBe(false)
  expect(nameMatcher('a+').test('a+b')).toBe(true)
})
