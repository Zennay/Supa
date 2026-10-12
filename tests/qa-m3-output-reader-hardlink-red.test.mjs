import assert from 'node:assert/strict'
import test from 'node:test'
import { link, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeDerivedM3Output } from '../scripts/m3-source-output-preservation.mjs'

// Additional synthetic #2039 acceptance on a frozen #2042 child: an unrelated
// hardlink target and readers observing a report during in-flight publication.
// Never use actual human field sheets, real retailer data, or real report paths.
async function withSyntheticPaths(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-readers-'))
  const source = join(dir, 'synthetic-input.json')
  const output = join(dir, 'synthetic-report.json')
  const sourceBytes = '{"private":"SYNTHETIC_TEST_ONLY_NOT_EVIDENCE"}\n'
  await writeFile(source, sourceBytes, { mode: 0o600 })
  try {
    await callback({ dir, source, output })
  } finally {
    // Also validate the evidence source when the case intentionally fails
    // (expected-RED tests otherwise bypass assertions after the callback).
    try {
      assert.equal(await readFile(source, 'utf8'), sourceBytes,
        'synthetic source bytes must be preserved, including on publication failure')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function gatedReport(firstChunk, rest) {
  let observedFirst
  const firstWritten = new Promise(resolve => { observedFirst = resolve })
  let release
  const gate = new Promise(resolve => { release = resolve })

  async function* bytes() {
    yield firstChunk
    // Node FileHandle.writeFile() requests the second yielded chunk only
    // after the first has been written. No wall-clock sleeps or flaky races.
    observedFirst()
    await gate
    yield rest
  }
  return { bytes: bytes(), firstWritten, release }
}

test('M3 report cannot mutate an unrelated hardlink on replacement [expected RED]', async () => {
  await withSyntheticPaths(async ({ dir, source, output }) => {
    const unrelated = join(dir, 'unrelated-private.json')
    const original = '{"unrelated":"KEEP_EXACT_BYTES"}\n'
    const replacement = '{"outcome":"unknown","publicSavingsClaimEligible":false}\n'
    await writeFile(unrelated, original, { mode: 0o600 })
    await link(unrelated, output)
    const prior = await stat(unrelated)
    assert.equal((await stat(output)).ino, prior.ino)

    let rejected = false
    try {
      await writeDerivedM3Output(source, output, replacement)
    } catch {
      rejected = true // Defensive refusal is valid if it preserves both paths.
    }
    assert.equal(await readFile(unrelated, 'utf8'), original,
      'publishing an M3 report must never change another hardlink to an unrelated file')
    if (rejected) {
      assert.equal(await readFile(output, 'utf8'), original)
    } else {
      assert.equal(await readFile(output, 'utf8'), replacement)
      assert.notEqual((await stat(output)).ino, (await stat(unrelated)).ino,
        'replacement must be a distinct inode, not an in-place hardlink mutation')
      assert.equal((await stat(output)).mode & 0o777, 0o600)
    }
  })
})

test('M3 readers must see complete old report during replacement [expected RED]', async () => {
  await withSyntheticPaths(async ({ source, output }) => {
    const oldReport = '{"outcome":"unknown","publicSavingsClaimEligible":false}\n'
    const first = '{"outcome":"'
    const rest = 'worse","publicSavingsClaimEligible":false}\n'
    await writeFile(output, oldReport, { mode: 0o600 })
    const staged = gatedReport(first, rest)
    const pending = writeDerivedM3Output(source, output, staged.bytes)
    try {
      await staged.firstWritten
      assert.equal(await readFile(output, 'utf8'), oldReport,
        'readers must not observe a truncated, empty or partially written report')
    } finally {
      staged.release()
      await pending
    }
    assert.equal(await readFile(output, 'utf8'), first + rest)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  })
})

test('M3 readers must not see an incomplete brand-new report [expected RED]', async () => {
  await withSyntheticPaths(async ({ source, output }) => {
    const first = '{"outcome":"'
    const rest = 'unknown","publicSavingsClaimEligible":false}\n'
    const staged = gatedReport(first, rest)
    const pending = writeDerivedM3Output(source, output, staged.bytes)
    try {
      await staged.firstWritten
      await assert.rejects(() => readFile(output, 'utf8'), { code: 'ENOENT' },
        'a new report must remain unpublished until all bytes are ready')
    } finally {
      staged.release()
      await pending
    }
    assert.equal(await readFile(output, 'utf8'), first + rest)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  })
})

test('M3 complete single-writer publication keeps source and 0600 private output [control]', async () => {
  await withSyntheticPaths(async ({ source, output }) => {
    const report = '{"outcome":"unknown","savingsCents":null,"publicSavingsClaimEligible":false}\n'
    await writeDerivedM3Output(source, output, report)
    assert.equal(await readFile(output, 'utf8'), report)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  })
})

test('M3 already-open readers must retain a stable prior snapshot after successful replacement [expected RED]', async () => {
  await withSyntheticPaths(async ({ source, output }) => {
    const oldReport = '{"outcome":"unknown","publicSavingsClaimEligible":false}\n'
    const newReport = '{"outcome":"worse","publicSavingsClaimEligible":false}\n'
    await writeFile(output, oldReport, { mode: 0o600 })
    const heldReader = await open(output, 'r')
    try {
      const before = await heldReader.stat()
      await writeDerivedM3Output(source, output, newReport)
      assert.equal(await readFile(output, 'utf8'), newReport)
      assert.equal(await heldReader.readFile('utf8'), oldReport,
        'an existing reader of a complete snapshot must never see in-place changed bytes')
      const after = await stat(output)
      assert.notEqual(after.ino, before.ino,
        'atomic publication must replace the pathname with a new inode, not mutate the open inode')
      assert.equal(after.mode & 0o777, 0o600)
    } finally {
      await heldReader.close()
    }
  })
})

test('M3 failure before first derived chunk preserves prior report and leaves no staging files [expected RED]', async () => {
  await withSyntheticPaths(async ({ dir, source, output }) => {
    const previous = '{"outcome":"unknown","publicSavingsClaimEligible":false}\n'
    await writeFile(output, previous, { mode: 0o600 })
    async function* rejectBeforeAnyOutput() {
      throw new Error('SYNTHETIC_SERIALIZATION_FAILED_BEFORE_FIRST_CHUNK')
    }
    await assert.rejects(
      () => writeDerivedM3Output(source, output, rejectBeforeAnyOutput()),
      /SYNTHETIC_SERIALIZATION_FAILED_BEFORE_FIRST_CHUNK/,
    )
    assert.equal(await readFile(output, 'utf8'), previous,
      'serialization errors must not erase even the first byte of an existing complete report')
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.deepEqual((await readdir(dir)).sort(), ['synthetic-input.json', 'synthetic-report.json'],
      'an interrupted publish cannot leave behind a readable temporary/staging artifact')
  })
})
