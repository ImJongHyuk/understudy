/**
 * heal/auto-probe conformance — the PURE deterministic-disclosure decision. Grounding auto-opens SAFE
 * disclosure affordances (tabs / collapsed accordions / <details> / menu openers / "show more"),
 * NEVER a control that writes or navigates away (it runs against the real backend). This locks both
 * arms: the safe affordances qualify, the destructive-named ones are refused even when they wear a
 * disclosure role, and the bounded budget goes to the richest disclosures first. Pure → no browser.
 */
import { test, expect } from '@playwright/test'
import { isSafeDisclosure, selectDisclosures, MAX_AUTO_DISCLOSURES, type Affordance } from '../../heal/auto-probe'

/** Build an Affordance with sensible defaults (a plain, unnamed button). */
const aff = (o: Partial<Affordance> = {}): Affordance => ({
  role: 'button',
  name: '',
  tag: 'button',
  expanded: null,
  hasPopup: null,
  ...o,
})

test('SAFE: a <details> toggle, a tab, a collapsed accordion, a menu opener, a named "show more"', () => {
  expect(isSafeDisclosure(aff({ tag: 'summary', role: 'summary' }))).toBe(true)
  expect(isSafeDisclosure(aff({ role: 'tab', name: 'Kanban' }))).toBe(true)
  expect(isSafeDisclosure(aff({ expanded: false, name: 'Advanced' }))).toBe(true) // collapsed disclosure
  expect(isSafeDisclosure(aff({ hasPopup: 'menu', name: 'Options' }))).toBe(true)
  expect(isSafeDisclosure(aff({ name: 'Show more' }))).toBe(true)
  expect(isSafeDisclosure(aff({ name: 'View comments' }))).toBe(true)
})

test('NOT safe: an already-expanded disclosure, a plain unnamed button, a dialog opener', () => {
  expect(isSafeDisclosure(aff({ expanded: true, name: 'Advanced' }))).toBe(false) // already open — nothing to reveal
  expect(isSafeDisclosure(aff({ name: 'OK' }))).toBe(false) // plain button, no disclosure semantics
  expect(isSafeDisclosure(aff({ hasPopup: 'dialog', name: 'Info' }))).toBe(false) // dialog is often a form (excluded)
})

test('the destructive-name guard OVERRIDES the disclosure role (real-backend safety)', () => {
  // Even a tab / menu / collapsed control is refused if its name implies a write or navigation-away —
  // grounding uses the real storageState, so the click would mutate real data.
  expect(isSafeDisclosure(aff({ role: 'tab', name: 'Delete account' }))).toBe(false)
  expect(isSafeDisclosure(aff({ expanded: false, name: 'Publish article' }))).toBe(false)
  expect(isSafeDisclosure(aff({ hasPopup: 'menu', name: 'Sign out' }))).toBe(false)
  expect(isSafeDisclosure(aff({ tag: 'summary', role: 'summary', name: 'Submit order' }))).toBe(false)
})

test('real-app plain-button openers pass (observed live: no ARIA semantics)', () => {
  // Vikunja ships these as bare buttons with no aria-haspopup/aria-expanded — name detection is the
  // only signal, so it must catch them.
  expect(isSafeDisclosure(aff({ name: 'Open project settings menu' }))).toBe(true)
  expect(isSafeDisclosure(aff({ name: 'FILTERS' }))).toBe(true)
  expect(isSafeDisclosure(aff({ name: 'SORT' }))).toBe(true)
})

test('CONCEAL controls are refused even with a disclosure keyword (they hide, not reveal)', () => {
  expect(isSafeDisclosure(aff({ name: 'Hide the menu' }))).toBe(false) // contains "menu" but conceals
  expect(isSafeDisclosure(aff({ name: 'Collapse sidebar' }))).toBe(false)
  expect(isSafeDisclosure(aff({ name: 'Close' }))).toBe(false)
  // and an APPLY (a mutation, not a disclosure) stays blocked by the destructive guard:
  expect(isSafeDisclosure(aff({ name: 'APPLY SORT' }))).toBe(false)
})

test('singular mutators are blocked but plural disclosures pass (word-boundary distinction)', () => {
  expect(isSafeDisclosure(aff({ name: 'Reply' }))).toBe(false) // opens/submits a reply form
  expect(isSafeDisclosure(aff({ name: 'Post comment' }))).toBe(false) // submit
  expect(isSafeDisclosure(aff({ name: 'View replies' }))).toBe(true) // disclosure of existing replies
  expect(isSafeDisclosure(aff({ name: 'Comments' }))).toBe(true) // a comments disclosure section
})

test('selectDisclosures filters the unsafe and caps at the budget', () => {
  const candidates = [
    aff({ name: 'Delete' }), // unsafe
    aff({ role: 'tab', name: 'List' }),
    aff({ role: 'tab', name: 'Table' }),
    aff({ name: 'OK' }), // unsafe (plain)
    aff({ expanded: false, name: 'Filters' }),
  ]
  const picked = selectDisclosures(candidates, 2)
  expect(picked.length).toBe(2)
  expect(picked.every(isSafeDisclosure)).toBe(true)
})

test('selectDisclosures ranks richer disclosures first (tabs > accordions > details > menus > named)', () => {
  const candidates = [
    aff({ name: 'Show more' }), // rank 4 (named)
    aff({ hasPopup: 'menu', name: 'Options' }), // rank 3
    aff({ tag: 'summary', role: 'summary', name: 'Section' }), // rank 2
    aff({ expanded: false, name: 'Advanced' }), // rank 1
    aff({ role: 'tab', name: 'Kanban' }), // rank 0
  ]
  const picked = selectDisclosures(candidates)
  expect(picked.map((a) => (a.role === 'tab' ? 'tab' : a.expanded === false ? 'accordion' : a.tag === 'summary' ? 'details' : a.hasPopup ? 'menu' : 'named'))).toEqual([
    'tab',
    'accordion',
    'details',
    'menu',
    'named',
  ])
})

test('selectDisclosures preserves a click marker carried on the descriptor (generic over T)', () => {
  // the live caller carries an `idx` marker through selection; the pure decision must not drop it.
  const withMarker = [
    { ...aff({ role: 'tab', name: 'A' }), idx: 7 },
    { ...aff({ name: 'plain' }), idx: 8 }, // unsafe — dropped
    { ...aff({ name: 'Show details' }), idx: 9 },
  ]
  const picked = selectDisclosures(withMarker)
  expect(picked.map((p) => p.idx)).toEqual([7, 9]) // tab first, then named; unsafe dropped
})

test('the default budget is the exported constant (bounded by construction)', () => {
  const many = Array.from({ length: 50 }, (_, i) => aff({ role: 'tab', name: `tab ${i}` }))
  expect(selectDisclosures(many).length).toBe(MAX_AUTO_DISCLOSURES)
})
