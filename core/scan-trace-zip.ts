/**
 * B11 — pure-Node, dependency-free zip reader + per-entry leak scanner for a
 * Playwright `trace.zip` (and any artifact zip). The B11 gate must scan INSIDE
 * a trace before it is uploaded, but the harness ships ZERO runtime deps and must
 * not shell out to `unzip` (a system tool may be absent → silent miss). So we read
 * the zip with the Node stdlib only (`node:zlib` for DEFLATE) and scan each entry
 * with the CORE `scanForLeaks`.
 *
 * CENTRAL-DIRECTORY-DRIVEN by design: Playwright streams traces with DATA
 * DESCRIPTORS, so a local file header's compressed/uncompressed sizes are 0 and the
 * real sizes trail the data in a `PK\x07\x08` record. The local header is therefore
 * NOT authoritative. We parse the End-Of-Central-Directory record, walk the central
 * directory (which always carries the true offset + compressed size + method + name),
 * seek to each local header, skip its name/extra fields, and read exactly
 * `compressedSize` bytes — independent of any data descriptor.
 *
 * cannot-run = RED: an entry we cannot decode (encrypted, AES/method 99, unsupported
 * method, zip64, a tampered central-directory count, or an offset-aliased local
 * header) THROWS — it is NEVER silently skipped, because a skipped entry could hide a
 * secret. EVERY decodable entry is scanned in full: there is NO content-based "looks
 * binary" skip, because an attacker controls that signal (a leading NUL, control-byte
 * padding, a secret past a sampled prefix). A leak gate must err toward a false
 * positive (block), never a false negative (skip).
 *
 * KNOWN LIMIT (inherent + accepted): bytes physically present but NOT referenced by any
 * central-directory record are not scanned. No conforming zip consumer (Info-ZIP, python
 * `zipfile`) surfaces them either — they reject overlapped / unreferenced data as a
 * possible zip bomb — and the gate targets ACCIDENTAL secret inclusion in a real trace,
 * not an insider hand-crafting unreferenced bytes. Overlapping (duplicate) local-header
 * offsets are themselves rejected (cannot-run = RED).
 *
 * Mutation-proven in core/conformance/trace-zip.spec.ts.
 */
import zlib from 'node:zlib'
import { scanForLeaks } from './redact-trace'
import type { Denylist } from './redact-trace'

// ZIP record signatures (little-endian, as stored).
const SIG_LOCAL = 0x04034b50 // PK\x03\x04 — local file header
const SIG_CENTRAL = 0x02014b50 // PK\x01\x02 — central directory file header
const SIG_EOCD = 0x06054b50 // PK\x05\x06 — end of central directory

/** Compression methods we can decode without a third-party dependency. */
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** Bit 0 of the general-purpose flags = the entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001

interface CentralEntry {
  readonly name: string
  readonly method: number
  readonly flags: number
  readonly compressedSize: number
  readonly localHeaderOffset: number
}

/** Locate the End-Of-Central-Directory record, scanning back from the buffer end. */
function findEocdOffset(zip: Buffer): number {
  // The EOCD is 22 bytes + a variable comment (max 0xffff). Scan backward from the
  // earliest position the fixed part could start so a trailing comment can't hide it.
  const minOffset = Math.max(0, zip.length - (22 + 0xffff))
  for (let i = zip.length - 22; i >= minOffset; i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * Read the central directory and return its entries. THROWS on a structurally
 * unreadable zip (cannot-run = RED) but treats a truly empty zip (no entries) as a
 * valid, hit-free archive.
 */
function readCentralDirectory(zip: Buffer): CentralEntry[] {
  if (zip.length === 0) return []
  const eocd = findEocdOffset(zip)
  if (eocd < 0) {
    throw new Error('trace-zip: no End-Of-Central-Directory record (not a zip / truncated)')
  }
  // zip64 is out of scope: Playwright traces are far below the 4 GiB / 65535-entry
  // thresholds. If a zip64 locator/EOCD is present, fail loud rather than misread.
  if (zip.length >= 20) {
    const z64loc = eocd - 20
    if (z64loc >= 0 && zip.readUInt32LE(z64loc) === 0x07064b50) {
      throw new Error('trace-zip: zip64 archive is unsupported (cannot-run = RED)')
    }
  }
  const totalEntries = zip.readUInt16LE(eocd + 10)
  if (totalEntries === 0xffff) {
    throw new Error('trace-zip: zip64 entry count is unsupported (cannot-run = RED)')
  }
  const cdOffset = zip.readUInt32LE(eocd + 16)
  if (cdOffset === 0xffffffff) {
    throw new Error('trace-zip: zip64 central-directory offset is unsupported (cannot-run = RED)')
  }

  // Walk EVERY central-directory record physically present (until the signature is no
  // longer PK\x01\x02), rather than trusting the EOCD's declared count: a count
  // patched DOWN must not hide an extra secret-bearing entry. The directory MUST then
  // run contiguously up to the EOCD AND its physical count MUST match the declared
  // count — any gap, stray record, or mismatch is a tamper/corruption signal.
  const entries: CentralEntry[] = []
  const seenOffsets = new Set<number>()
  let ptr = cdOffset
  while (ptr + 46 <= zip.length && zip.readUInt32LE(ptr) === SIG_CENTRAL) {
    const flags = zip.readUInt16LE(ptr + 8)
    const method = zip.readUInt16LE(ptr + 10)
    const compressedSize = zip.readUInt32LE(ptr + 20)
    const nameLen = zip.readUInt16LE(ptr + 28)
    const extraLen = zip.readUInt16LE(ptr + 30)
    const commentLen = zip.readUInt16LE(ptr + 32)
    const localHeaderOffset = zip.readUInt32LE(ptr + 42)
    // Two central records pointing at the SAME local header = overlapped/aliased entries
    // (the "possible zip bomb" Info-ZIP and python's zipfile also refuse). It lets a
    // same-named record alias a clean entry's data while a secret hides in unreferenced
    // bytes, slipping past the name-match guard below — cannot-run = RED. A well-formed
    // archive never shares a local-header offset across entries.
    if (seenOffsets.has(localHeaderOffset)) {
      throw new Error(
        `trace-zip: duplicate local-header offset ${localHeaderOffset} across central ` +
          `records (overlapped / aliased entries) — cannot-run = RED`,
      )
    }
    seenOffsets.add(localHeaderOffset)
    const name = zip.toString('utf-8', ptr + 46, ptr + 46 + nameLen)
    entries.push({ name, method, flags, compressedSize, localHeaderOffset })
    ptr += 46 + nameLen + extraLen + commentLen
  }
  if (ptr !== eocd) {
    throw new Error(
      'trace-zip: central directory is not contiguous up to the EOCD ' +
        '(truncated / tampered / zip64) — cannot-run = RED',
    )
  }
  if (entries.length !== totalEntries) {
    throw new Error(
      `trace-zip: central-directory count mismatch (EOCD declares ${totalEntries}, ` +
        `found ${entries.length}) — cannot-run = RED`,
    )
  }
  return entries
}

/**
 * Decompress one entry's raw bytes. The CENTRAL directory supplies the authoritative
 * method + compressedSize; the local header is only used to find where the data
 * starts (its name/extra lengths can differ from the central copy). THROWS for any
 * method we cannot decode — cannot-run = RED, never a silent skip.
 */
function readEntryBytes(zip: Buffer, e: CentralEntry): Buffer {
  if ((e.flags & FLAG_ENCRYPTED) !== 0) {
    throw new Error(`trace-zip: entry "${e.name}" is encrypted — cannot scan (cannot-run = RED)`)
  }
  const lh = e.localHeaderOffset
  if (lh + 30 > zip.length || zip.readUInt32LE(lh) !== SIG_LOCAL) {
    throw new Error(`trace-zip: entry "${e.name}" has no local header (cannot-run = RED)`)
  }
  const nameLen = zip.readUInt16LE(lh + 26)
  const extraLen = zip.readUInt16LE(lh + 28)
  // The local header's name MUST equal the central entry's name. A mismatch means this
  // central record's offset was redirected at another (clean) entry's data —
  // "offset-aliasing" — to hide this entry's real bytes from the scan. cannot-run = RED.
  const localName = zip.toString('utf-8', lh + 30, lh + 30 + nameLen)
  if (localName !== e.name) {
    throw new Error(
      `trace-zip: entry "${e.name}" local-header name mismatch ("${localName}") ` +
        `— offset-aliasing / tamper, cannot-run = RED`,
    )
  }
  const dataStart = lh + 30 + nameLen + extraLen
  const dataEnd = dataStart + e.compressedSize
  if (dataEnd > zip.length) {
    throw new Error(`trace-zip: entry "${e.name}" data runs past end of buffer (cannot-run = RED)`)
  }
  const raw = zip.subarray(dataStart, dataEnd)
  if (e.method === METHOD_STORE) return Buffer.from(raw)
  if (e.method === METHOD_DEFLATE) return zlib.inflateRawSync(raw)
  throw new Error(
    `trace-zip: entry "${e.name}" uses unsupported compression method ${e.method} ` +
      `(encrypted/AES/zip64?) — cannot scan (cannot-run = RED)`,
  )
}

export interface EntryScan {
  /** The zip-internal entry name (path), e.g. `resources/<hash>` or `trace.network`. */
  readonly entry: string
  /** Leak categories found in this entry (empty = clean). */
  readonly hits: string[]
}

/**
 * Scan every entry of a zip for leaks. Returns one result per entry (empty `hits` =
 * clean). Every decodable entry is scanned in full (no binary skip); an entry we
 * cannot decode, or a tampered / offset-aliased structure, THROWS (cannot-run = RED).
 * The caller treats any non-empty `hits` as a blocking leak.
 */
export function scanZipForLeaks(zip: Buffer, dl: Denylist): EntryScan[] {
  const entries = readCentralDirectory(zip)
  const results: EntryScan[] = []
  for (const e of entries) {
    // Directory entries carry no data; nothing to scan.
    if (e.name.endsWith('/')) {
      results.push({ entry: e.name, hits: [] })
      continue
    }
    const bytes = readEntryBytes(zip, e)
    // Scan EVERY entry's full content — never skip by "looks binary". An attacker
    // controls whether an entry looks binary (a leading NUL, control-byte padding, a
    // secret past a sampled prefix), so a content-based skip is a leak vector. latin1
    // maps bytes 1:1 so an ASCII secret embedded in binary stays intact; a token-shape
    // false match on real image bytes is vanishingly rare and errs the safe way (block).
    const hits = scanForLeaks(bytes.toString('latin1'), dl)
    results.push({ entry: e.name, hits })
  }
  return results
}
