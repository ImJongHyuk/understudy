/**
 * heal/auto-probe — DETERMINISTIC grounding disclosure (the "capability ≠ use" lever).
 *
 * The grounding probe lets the model pass `clicks` (heal/probe.ts) to reach interaction-gated
 * controls — but a weak model often doesn't KNOW to ask: a tab / accordion / menu-gated control stays
 * out of the `get_accessibility` snapshot, so the model can't see the real target and blind-guesses
 * (the documented vacuous-heal failure on interaction-gated surfaces). This makes the HARNESS surface
 * those controls WITHOUT being told — it scans for SAFE disclosure affordances (tabs, collapsed
 * `aria-expanded` toggles, `<details>`, menu openers, "show more"-style buttons), opens each (bounded),
 * and snapshots the revealed state. Structure-of-observation over model-tier: give the model the
 * evidence deterministically instead of hoping it requests it.
 *
 * The SELECTION here is PURE (which affordances are safe to auto-open, and which win a bounded budget)
 * → conformance-tested; the clicking + sub-snapshotting is the live application (real-tools
 * get_accessibility), mirroring how heal/settle's pure `renderSettled` backs the live `settleRender`.
 *
 * SAFETY (load-bearing): grounding runs against the REAL backend with the real `storageState`, so a
 * destructive click (delete / submit / publish / follow …) would MUTATE real data — even in the
 * throwaway context. Auto-probe therefore opens ONLY disclosure-semantic affordances and NEVER a
 * control whose accessible name implies a write / navigation-away / state mutation. When in doubt it
 * declines: a missed disclosure only costs a little evidence, a wrong click corrupts the run.
 */

/** The minimal element descriptor the live scan collects per candidate; the pure decision reads only
 * these fields (the live side may carry extra fields, e.g. a click marker — structurally ignored). */
export interface Affordance {
  /** ARIA role (explicit `role=` or the implicit role, e.g. 'tab' | 'button' | 'link' | 'summary'). */
  readonly role: string
  /** accessible name (an approximation is fine — it's matched against keyword lists, not parsed). */
  readonly name: string
  /** lowercased tagName, e.g. 'summary' | 'button' | 'a'. */
  readonly tag: string
  /** `aria-expanded` as a bool, or null when the attribute is absent. `false` = a COLLAPSED disclosure. */
  readonly expanded: boolean | null
  /** `aria-haspopup` value (e.g. 'menu' | 'listbox' | 'dialog' | 'true'), or null when absent. */
  readonly hasPopup: string | null
}

/** Default cap on auto-opened affordances per grounding snapshot — bounded so a control-dense page
 * can't explode the snapshot or the time budget. */
export const MAX_AUTO_DISCLOSURES = 6

/** Accessible names that imply a WRITE / navigation-away / state mutation — NEVER auto-clicked. Biased
 * to over-match: a false block only forgoes some evidence, a false allow can corrupt real data. Word
 * boundaries keep the singular mutators ("comment", "reply") distinct from plural disclosures
 * ("comments", "replies"), which are handled by the allow-list below. */
export const DESTRUCTIVE_NAME =
  /\b(delete|remove|destroy|trash|archive|unarchive|publish|unpublish|submit|save|update|edit|rename|move|duplicate|create|new|add|insert|upload|import|export|post|send|share|reply|comment|pay|buy|purchase|checkout|order|confirm|accept|decline|approve|reject|apply|follow|unfollow|subscribe|unsubscribe|favorite|unfavorite|star|like|vote|sign\s?out|log\s?out|logout|sign\s?in|log\s?in|login|register|sign\s?up)\b/i

/** Disclosure verbs/nouns on an otherwise-plain control that reveal more content. Real SPAs often ship
 * menu/filter/sort openers as PLAIN buttons with NO `aria-haspopup`/`aria-expanded` (observed live on
 * Vikunja: "Open project settings menu", "FILTERS", "SORT" — all bare buttons), so name detection is
 * needed in addition to the ARIA signals below. The CONCEAL guard keeps this from firing on the
 * opposite control ("Hide the menu", "Collapse sidebar"), and the destructive guard keeps "APPLY SORT"
 * (a mutation) out. */
export const DISCLOSURE_NAME = /\b(show|more|expand|view|details?|comments|replies|see all|read more|menu|options?|filters?|sort|settings)\b/i

/** Names that CONCEAL rather than disclose — clicking them hides content, so they're never useful (and
 * would undo a disclosure). Checked before the positive signals so e.g. "Hide the menu" is refused even
 * though it contains the "menu" disclosure keyword. */
export const CONCEAL_NAME = /\b(hide|close|collapse|dismiss|minimi[sz]e)\b/i

/** `aria-haspopup` kinds that open a NON-form popup (a menu/list to read) — safe to open. 'dialog' is
 * excluded: a dialog is often a create/edit FORM, not a disclosure. */
export const SAFE_POPUP: ReadonlySet<string> = new Set(['menu', 'listbox', 'tree', 'grid', 'true'])

/**
 * Is this affordance SAFE for the harness to auto-open during grounding? The destructive-name guard is
 * checked FIRST and overrides everything (a tab/menu named "Delete account" is still off-limits), then
 * the CONCEAL guard ("Hide the menu" hides, it doesn't disclose). Then the disclosure-semantic
 * affordances qualify: a `<details>` toggle, a tab, a COLLAPSED `aria-expanded` control
 * (accordion/expander), a menu/listbox opener, or a disclosure-named button ("show more" / "filters" /
 * "open … menu"). Everything else declines. Pure.
 */
export function isSafeDisclosure(a: Affordance): boolean {
  if (DESTRUCTIVE_NAME.test(a.name)) return false
  if (CONCEAL_NAME.test(a.name)) return false // hides content (e.g. "Hide the menu") — never a disclosure
  if (a.tag === 'summary') return true // a <details> toggle — purely additive
  if (a.role === 'tab') return true // switches the tab panel — non-destructive disclosure
  if (a.expanded === false) return true // a COLLAPSED disclosure (accordion / expander)
  if (a.hasPopup !== null && SAFE_POPUP.has(a.hasPopup)) return true // a menu/listbox opener
  if (DISCLOSURE_NAME.test(a.name)) return true // a generic "show more" / "view" / "options" control
  return false
}

/** Rank a safe affordance by information value, so the bounded budget goes to the richest disclosures
 * first: tabs (whole panels) > collapsed accordions > `<details>` > menu openers > generically-named. */
function disclosureRank(a: Affordance): number {
  if (a.role === 'tab') return 0
  if (a.expanded === false) return 1
  if (a.tag === 'summary') return 2
  if (a.hasPopup !== null && SAFE_POPUP.has(a.hasPopup)) return 3
  return 4
}

/**
 * From the scanned candidates, pick the SAFE ones the harness should auto-open, highest-value first,
 * capped at `max`. Generic over the descriptor type so the live caller can carry a click marker
 * through (the pure decision ignores any extra fields). Stable: equal ranks keep their scan order.
 */
export function selectDisclosures<T extends Affordance>(
  candidates: readonly T[],
  max: number = MAX_AUTO_DISCLOSURES,
): T[] {
  return candidates
    .filter(isSafeDisclosure)
    .map((a, i) => ({ a, i })) // carry original index for a stable sort (Array.sort isn't guaranteed stable across all fields)
    .sort((x, y) => disclosureRank(x.a) - disclosureRank(y.a) || x.i - y.i)
    .slice(0, Math.max(0, max))
    .map((x) => x.a)
}
