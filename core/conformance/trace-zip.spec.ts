/**
 * B11 trace.zip leak-scan CONFORMANCE / mutation proofs — HERMETIC (pure-unit; no
 * browser, no network, NO system tools like `unzip`). Proves that the central-
 * directory-driven, dependency-free reader (`core/scan-trace-zip.ts`) scans INSIDE a
 * zip the way Playwright actually writes one: with DATA DESCRIPTORS (local-header
 * sizes = 0), with STORE and DEFLATE entries, content-based (not extension-based) text
 * detection, and cannot-run = RED for any entry it cannot decode.
 *
 * To stay hermetic we build the zips with a small pure-Node ZIP WRITER below (local
 * headers + central directory + EOCD; STORE via raw bytes, DEFLATE via
 * zlib.deflateRawSync, plus a streaming DATA-DESCRIPTOR variant). The reader is then
 * exercised against bytes WE control — so a mutation that makes the reader trust the
 * local header (instead of the central directory), skip an entry, or mis-detect text
 * vs binary fails a test.
 */
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { buildDenylist } from '../redact-trace'
import { scanZipForLeaks } from '../scan-trace-zip'

// -- Pure-Node ZIP WRITER (test fixture only) --------------------------------------

interface ZipInput {
  readonly name: string
  readonly data: Buffer
  /** 0 = STORE, 8 = DEFLATE. Default 8. */
  readonly method?: number
  /** Write a streaming local header (sizes/crc = 0) + trailing data descriptor. */
  readonly dataDescriptor?: boolean
  /** Force a general-purpose-flags value (e.g. set the encrypted bit) on both headers. */
  readonly forceFlags?: number
  /** Override the compression method byte stored on disk (to fake an unsupported one). */
  readonly forceMethod?: number
  /** Override the central record's local-header offset (to forge offset-aliasing). */
  readonly forceCentralOffset?: number
}

// CRC-32 (IEEE 802.3) — standard zip checksum; table built once.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Build a minimal but spec-faithful zip. When `dataDescriptor` is set, the local
 * header carries sizes/crc = 0 and bit 3 of the flags is set, with a real
 * `PK\x07\x08` descriptor trailing the data — exactly how Playwright streams a trace.
 * The central directory always carries the TRUE crc/sizes/offset, so a correct reader
 * relies on it (not the local header).
 */
function makeZip(inputs: readonly ZipInput[], opts: { forceTotalEntries?: number } = {}): Buffer {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const inp of inputs) {
    const method = inp.method ?? 8
    const stored = method === 0 ? inp.data : zlib.deflateRawSync(inp.data)
    const crc = crc32(inp.data)
    const nameBuf = Buffer.from(inp.name, 'utf-8')
    const useDD = inp.dataDescriptor === true
    // Bit 3 (0x08) tells readers the sizes live in a trailing data descriptor.
    const flags = inp.forceFlags ?? (useDD ? 0x0008 : 0x0000)
    const methodOnDisk = inp.forceMethod ?? method

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // PK\x03\x04
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(methodOnDisk, 8)
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0, 12) // mod date
    // Streaming: local header crc/sizes are 0; the descriptor carries the truth.
    local.writeUInt32LE(useDD ? 0 : crc, 14)
    local.writeUInt32LE(useDD ? 0 : stored.length, 18)
    local.writeUInt32LE(useDD ? 0 : inp.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len

    const localParts: Buffer[] = [local, nameBuf, stored]
    if (useDD) {
      const dd = Buffer.alloc(16)
      dd.writeUInt32LE(0x08074b50, 0) // PK\x07\x08 data descriptor signature
      dd.writeUInt32LE(crc, 4)
      dd.writeUInt32LE(stored.length, 8)
      dd.writeUInt32LE(inp.data.length, 12)
      localParts.push(dd)
    }
    const localBuf = Buffer.concat(localParts)
    localChunks.push(localBuf)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // PK\x01\x02
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(methodOnDisk, 10)
    central.writeUInt16LE(0, 12) // mod time
    central.writeUInt16LE(0, 14) // mod date
    central.writeUInt32LE(crc, 16) // authoritative crc
    central.writeUInt32LE(stored.length, 20) // authoritative compressed size
    central.writeUInt32LE(inp.data.length, 24) // authoritative uncompressed size
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra len
    central.writeUInt16LE(0, 32) // comment len
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(inp.forceCentralOffset ?? offset, 42) // authoritative local header offset
    centralChunks.push(Buffer.concat([central, nameBuf]))

    offset += localBuf.length
  }

  const localBytes = Buffer.concat(localChunks)
  const centralBytes = Buffer.concat(centralChunks)
  // A non-empty comment proves the EOCD scan is robust to a trailing comment.
  const comment = Buffer.from('understudy-test', 'utf-8')
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // PK\x05\x06
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central dir
  const declaredEntries = opts.forceTotalEntries ?? inputs.length
  eocd.writeUInt16LE(declaredEntries, 8) // entries on this disk
  eocd.writeUInt16LE(declaredEntries, 10) // total entries
  eocd.writeUInt32LE(centralBytes.length, 12) // central dir size
  eocd.writeUInt32LE(localBytes.length, 16) // central dir offset
  eocd.writeUInt16LE(comment.length, 20)

  return Buffer.concat([localBytes, centralBytes, eocd, comment])
}

// -- The denylist (built exactly like trust.spec.ts) -------------------------------

const env = {
  APP_PASSWORD: 'p4ss-secret-xyz',
  APP_API_TOKEN: 'tok_live_abcdef123456',
} as NodeJS.ProcessEnv
const dl = buildDenylist({
  env,
  envNames: ['APP_PASSWORD', 'APP_API_TOKEN'],
  extraPatterns: [/tok_[A-Za-z0-9]{6,}/g],
})

/** Collect entries that have at least one hit. */
function leakyEntries(zip: Buffer): { entry: string; hits: string[] }[] {
  return scanZipForLeaks(zip, dl).filter((r) => r.hits.length > 0)
}

// PNG magic + NUL runs + a non-secret profile string: genuinely-binary content that
// carries NO secret value and NO token shape. The scanner no longer SKIPS binary (a
// content-based skip is a leak vector an attacker controls) — it scans EVERYTHING — so
// this benign blob must simply produce no hits (no false positive on real image bytes).
const BENIGN_BINARY = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(128, 0),
  Buffer.from('iCCP-profile chunk: display-p3'),
  Buffer.alloc(64, 0xab),
])

test.describe('conformance: B11 trace.zip leak-scan (mutation-proven, hermetic)', () => {
  test('a STORE entry carrying a Bearer auth header is a hit on that entry', () => {
    const zip = makeZip([
      {
        name: 'trace.network',
        method: 0,
        data: Buffer.from('authorization: Bearer abcDEF1234567890token\n'),
      },
    ])
    const leaks = leakyEntries(zip)
    expect(leaks.map((l) => l.entry)).toEqual(['trace.network'])
    expect(leaks[0].hits.length).toBeGreaterThan(0)
  })

  test('a DEFLATE entry carrying a secret value is found (proves inflation)', () => {
    const zip = makeZip([
      {
        name: 'trace.trace',
        method: 8,
        data: Buffer.from('{"requestBody":"password=p4ss-secret-xyz"}'),
      },
    ])
    const leaks = leakyEntries(zip)
    expect(leaks.map((l) => l.entry)).toEqual(['trace.trace'])
    expect(leaks[0].hits).toContain('value:env-secret')
  })

  test('a DATA-DESCRIPTOR deflate entry is found (proves the central-directory path)', () => {
    // Local-header sizes are 0; the truth is in the central directory + descriptor.
    const zip = makeZip([
      {
        name: 'resources/0abc',
        method: 8,
        dataDescriptor: true,
        data: Buffer.from('GET /api {"token":"tok_live_abcdef123456"}'),
      },
    ])
    const leaks = leakyEntries(zip)
    expect(leaks.map((l) => l.entry)).toEqual(['resources/0abc'])
    expect(leaks[0].hits.length).toBeGreaterThan(0)
  })

  test('a clean zip (plain request log) has no hits', () => {
    const zip = makeZip([
      { name: 'trace.network', method: 8, data: Buffer.from('GET /api/items 200\n') },
      { name: 'trace.stacks', method: 0, dataDescriptor: true, data: Buffer.from('GET /api/tags 200\n') },
    ])
    expect(leakyEntries(zip)).toEqual([])
  })

  test('a benign binary entry produces NO false positive (scanned in full, not skipped)', () => {
    const zip = makeZip([
      { name: 'resources/deadbeef', method: 0, dataDescriptor: true, data: BENIGN_BINARY },
      { name: 'resources/cafef00d', method: 8, dataDescriptor: true, data: Buffer.from('GET /api/items 200\n') },
    ])
    expect(leakyEntries(zip)).toEqual([])
  })

  // Re-refute regression: the scanner must NOT skip "binary-looking" entries — an
  // attacker controls that signal. A real secret behind a leading NUL, behind heavy
  // control-byte padding, or PAST an 8 KiB binary-looking prefix must all be caught.
  test('a secret behind a leading NUL byte is caught (no binary skip)', () => {
    const zip = makeZip([
      {
        name: 'resources/0nul',
        method: 8,
        dataDescriptor: true,
        data: Buffer.concat([Buffer.from([0x00]), Buffer.from('authorization: Bearer abcDEF1234567890token')]),
      },
    ])
    expect(leakyEntries(zip).map((l) => l.entry)).toEqual(['resources/0nul'])
  })

  test('a secret behind heavy control-byte padding is caught (no >30% binary skip)', () => {
    const zip = makeZip([
      {
        name: 'resources/pad',
        method: 8,
        dataDescriptor: true,
        data: Buffer.concat([Buffer.alloc(80, 0x01), Buffer.from('password=p4ss-secret-xyz')]),
      },
    ])
    expect(leakyEntries(zip)[0]?.hits).toContain('value:env-secret')
  })

  test('a secret PAST an 8 KiB binary-looking prefix is caught (whole entry scanned)', () => {
    const zip = makeZip([
      {
        name: 'resources/big',
        method: 8,
        dataDescriptor: true,
        data: Buffer.concat([Buffer.alloc(9000, 0x00), Buffer.from('\ntoken=tok_live_abcdef123456\n')]),
      },
    ])
    expect(leakyEntries(zip).map((l) => l.entry)).toEqual(['resources/big'])
  })

  test('an empty zip (no entries) is clean, not a throw', () => {
    const zip = makeZip([])
    expect(scanZipForLeaks(zip, dl)).toEqual([])
  })

  test('an ENCRYPTED entry is cannot-run = RED (THROWS, never silently skipped)', () => {
    const zip = makeZip([
      {
        name: 'resources/secret',
        method: 8,
        // Set the encrypted bit (0x0001); a real reader cannot decode the payload.
        forceFlags: 0x0001,
        data: Buffer.from('authorization: Bearer abcDEF1234567890token'),
      },
    ])
    expect(() => scanZipForLeaks(zip, dl)).toThrow(/encrypted|cannot-run/i)
  })

  test('an UNSUPPORTED compression method is cannot-run = RED (THROWS)', () => {
    const zip = makeZip([
      {
        name: 'resources/aes',
        method: 0, // store the bytes raw...
        forceMethod: 99, // ...but advertise method 99 (AES) on disk → undecodable
        data: Buffer.from('GET /api/items 200\n'),
      },
    ])
    expect(() => scanZipForLeaks(zip, dl)).toThrow(/unsupported|cannot-run/i)
  })

  test('a truncated / non-zip buffer is cannot-run = RED (THROWS, no silent pass)', () => {
    expect(() => scanZipForLeaks(Buffer.from('not a zip at all'), dl)).toThrow(
      /End-Of-Central-Directory|cannot-run|not a zip/i,
    )
  })

  // Re-refute regression: an EOCD entry-count patched DOWN must not hide an extra
  // secret-bearing central record. The reader walks the PHYSICAL directory; a count
  // mismatch is cannot-run = RED — it does NOT silently scan only the declared subset.
  test('an EOCD entry-count undercount is cannot-run = RED (THROWS, hides nothing)', () => {
    const zip = makeZip(
      [
        { name: 'trace.network', method: 8, data: Buffer.from('GET /api/items 200\n') },
        { name: 'resources/hidden', method: 8, data: Buffer.from('authorization: Bearer abcDEF1234567890token') },
      ],
      { forceTotalEntries: 1 }, // physically 2 central records, but the EOCD lies "1"
    )
    expect(() => scanZipForLeaks(zip, dl)).toThrow(/count mismatch|contiguous|cannot-run/i)
  })

  // Re-refute regression: a central record whose local-header offset is redirected at
  // another (clean) entry's data — "offset-aliasing" — must THROW on the name mismatch,
  // never scan the decoy bytes under the hidden entry's name.
  test('offset-aliasing (central offset redirected) is cannot-run = RED (THROWS)', () => {
    const zip = makeZip([
      { name: 'resources/clean', method: 0, data: Buffer.from('GET /api/items 200\n') },
      {
        name: 'resources/secret',
        method: 0,
        data: Buffer.from('authorization: Bearer abcDEF1234567890token'),
        forceCentralOffset: 0, // point this record's data at the FIRST (clean) local header
      },
    ])
    expect(() => scanZipForLeaks(zip, dl)).toThrow(/name mismatch|offset-aliasing|cannot-run/i)
  })

  // Re-refute regression: SAME-NAME offset-aliasing slips past the name-match guard
  // (both central records carry the same name), but the two records then share a
  // local-header offset — overlapped/aliased entries that Info-ZIP + python's zipfile
  // also refuse as a possible zip bomb. The duplicate-offset guard catches it.
  test('same-name offset-aliasing (duplicate local-header offset) is cannot-run = RED (THROWS)', () => {
    const zip = makeZip([
      { name: 'resources/x', method: 0, data: Buffer.from('GET /api/items 200\n') },
      {
        name: 'resources/x', // identical name slips past the name-match guard...
        method: 0,
        data: Buffer.from('authorization: Bearer abcDEF1234567890token'),
        forceCentralOffset: 0, // ...but both records now point at the same local header
      },
    ])
    expect(() => scanZipForLeaks(zip, dl)).toThrow(/duplicate local-header offset|overlap|cannot-run/i)
  })
})
