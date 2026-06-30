/**
 * Spec-lint CLI — scans every adapter's spec files with the CORE `lintSpecText`
 * and exits non-zero on any violation (no hard waits / no raw page selectors).
 * Run: `bun run lint:specs`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { lintSpecText } from '../core/lint-specs'

const ADAPTERS_DIR = 'adapters'

function specFiles(): string[] {
  if (!fs.existsSync(ADAPTERS_DIR)) return []
  return fs
    .readdirSync(ADAPTERS_DIR)
    .map((a) => path.join(ADAPTERS_DIR, a, 'specs'))
    .filter((d) => fs.existsSync(d))
    .flatMap((d) =>
      fs
        .readdirSync(d)
        .filter((f) => f.endsWith('.spec.ts'))
        .map((f) => path.join(d, f)),
    )
}

const files = specFiles()
let total = 0
for (const f of files) {
  for (const v of lintSpecText(fs.readFileSync(f, 'utf-8'))) {
    console.error(`${f}:${v.line} [${v.rule}] ${v.text}`)
    total++
  }
}

if (total > 0) {
  console.error(`\nspec lint: ${total} violation(s) across ${files.length} file(s)`)
  process.exit(1)
}
console.log(`spec lint: clean (${files.length} file(s))`)
