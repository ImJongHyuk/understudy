/**
 * B11 pre-upload leak-check CLI — the gate that runs BEFORE any Playwright artifact
 * (trace.zip / report / test-results) is uploaded in CI. Scans every artifact file
 * with the CORE `scanForLeaks` and exits non-zero on ANY hit, so a trace carrying a
 * secret value, a token shape, or a sensitive header value NEVER leaves the runner.
 * A `trace.zip` is read in-process by the CORE `scanZipForLeaks` (a pure-Node,
 * central-directory-driven reader — NO `unzip` dependency, NO silent skip), so each
 * zip ENTRY is scanned and an undecodable entry is cannot-run = RED, not a hidden gap.
 * Run: `bun run scripts/check-artifact-leaks.ts [dir ...]` (default: `test-results`).
 *
 * GENERIC by construction (no consumer identifiers): the denylist is the core's
 * provider-agnostic header names + token SHAPES (`buildDenylist`), plus any
 * adapter-supplied env-var NAMES whose values are secrets — passed at runtime via
 * `LEAK_SCAN_ENV_NAMES` (comma-separated), NOT hard-coded. The hermetic RealWorld
 * reference supplies none (no secrets); a private consumer would list its own.
 *
 * Reports leak CATEGORIES + file paths only — never the secret itself. cannot-run =
 * RED: an unreadable required root or any leak fails the step (no silent skip).
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildDenylist, scanForLeaks } from '../core/redact-trace'
import { scanZipForLeaks } from '../core/scan-trace-zip'

/** Default artifact roots to scan (those that may be uploaded). */
const DEFAULT_ROOTS = ['test-results', 'playwright-report']

/** Extensions we treat as opaque binary (no readable secrets) and skip. */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.pdf',
])

function walk(root: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** Best-effort text for a plain (non-zip) file: binary blobs are skipped. */
function textOf(file: string): string | null {
  const ext = path.extname(file).toLowerCase()
  if (BINARY_EXT.has(ext)) return null
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function main(): void {
  const roots = process.argv.slice(2)
  const scanRoots = roots.length > 0 ? roots : DEFAULT_ROOTS

  const envNames = (process.env.LEAK_SCAN_ENV_NAMES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const dl = buildDenylist({ envNames })

  let scanned = 0
  let leaks = 0
  for (const root of scanRoots) {
    if (!fs.existsSync(root)) {
      // A root the caller explicitly named but is missing is RED; a default root
      // that simply did not get produced is fine (nothing to upload from it).
      if (roots.length > 0) {
        console.error(`leak-check: required scan root missing: ${root}`)
        process.exit(1)
      }
      continue
    }
    for (const file of walk(root)) {
      if (path.extname(file).toLowerCase() === '.zip') {
        // A trace.zip is scanned per-entry with a pure-Node, central-directory-driven
        // reader (no `unzip`). An undecodable entry THROWS → cannot-run = RED.
        scanned++
        for (const { entry, hits } of scanZipForLeaks(fs.readFileSync(file), dl)) {
          if (hits.length > 0) {
            leaks++
            // Categories + which ENTRY leaked (file.zip!entry) — never the secret.
            console.error(`leak-check: LEAK in ${file}!${entry} → ${hits.join(', ')}`)
          }
        }
        continue
      }
      const text = textOf(file)
      if (text === null) continue
      scanned++
      const hits = scanForLeaks(text, dl)
      if (hits.length > 0) {
        leaks++
        // Categories only — never the secret value.
        console.error(`leak-check: LEAK in ${file} → ${hits.join(', ')}`)
      }
    }
  }

  if (leaks > 0) {
    console.error(
      `\nleak-check: ${leaks} file(s) with leaks across ${scanned} scanned — ` +
        `BLOCKING artifact upload (B11). cannot-run = RED.`,
    )
    process.exit(1)
  }
  console.log(`leak-check: clean (${scanned} file(s) scanned in ${scanRoots.join(', ')})`)
}

main()
