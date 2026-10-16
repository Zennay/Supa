import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent EXPECTED-RED QA: archived raw bytes must not become apparently
// unambiguous provenance when JSON.parse silently overwrites duplicate keys.
// Files are freshly created synthetic PRIVATE local fixtures, never retailer
// requests or current/authorized price evidence.
async function withPrivateFixture(bytes, verify) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-reviewed-json-'))
  const filename = join(directory, 'source.json')
  try {
    await writeFile(filename, bytes, { mode: 0o600, flag: 'wx' })
    return await verify(filename)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('positive control: valid unique-key JSON remains readable from private regular file', async () => {
  const original = '{"version":1,"source":{"capturedAt":"2026-10-04T18:15:30.306Z","sha256":"'
    + 'a'.repeat(64) + '"},"cards":[]}'
  await withPrivateFixture(original, async filename => {
    assert.deepEqual(await readBoundedRegularReviewedFixture(filename), JSON.parse(original))
  })
})

test('raw archived source must refuse duplicate top-level source before silent overwrite [EXPECTED RED]', async () => {
  const original = '{"version":1,"source":{"supermarket":"plus"},"source":{"supermarket":"dekamarkt"}}'
  await withPrivateFixture(original, async filename => {
    await assert.rejects(
      readBoundedRegularReviewedFixture(filename),
      /duplicate|ambiguous|conflicting|untrusted|refus/i,
    )
  })
})

test('raw archived capture must refuse Unicode-escaped duplicate provenance keys [EXPECTED RED]', async () => {
  const original = String.raw`{"source":{"capturedAt":"2026-10-04T18:15:30.306Z","captured\u0041t":"2026-10-05T18:15:30.306Z"}}`
  await withPrivateFixture(original, async filename => {
    await assert.rejects(
      readBoundedRegularReviewedFixture(filename),
      /duplicate|ambiguous|conflicting|untrusted|refus/i,
    )
  })
})

test('raw archived nested offer cannot accept two contradictory cents values [EXPECTED RED]', async () => {
  const original = '{"offer":{"offerPriceCents":199,"offerPriceCents":1}}'
  await withPrivateFixture(original, async filename => {
    await assert.rejects(
      readBoundedRegularReviewedFixture(filename),
      /duplicate|ambiguous|conflicting|untrusted|refus/i,
    )
  })
})
