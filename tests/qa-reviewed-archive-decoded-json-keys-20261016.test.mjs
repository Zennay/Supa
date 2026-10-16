import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent offline archived-source parser acceptance. All disk fixtures
// are synthetic, temporary 0600 files. No network or fresh retailer prices.
async function privateJson(source, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-json-key-qa-'))
  const file = join(dir, 'reviewed.json')
  try {
    await writeFile(file, source, { flag: 'wx', mode: 0o600 })
    return await fn(file)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

const decodedAliases = [
  ['source', String.raw`so\u0075rce`],
  ['capturedAt', String.raw`captured\u0041t`],
  ['offerPriceCents', String.raw`offerPrice\u0043ents`],
  ['sha256', String.raw`s\u0068a256`],
  ['slash/key', String.raw`slash\/key`],
  ['Supa', String.raw`\u0053upa`],
  ['é', String.raw`\u00e9`],
  ['🛒', String.raw`\ud83d\uded2`],
]

test('eight Unicode/escaped aliases cannot overwrite a source key in an offline archive', async () => {
  for (const [key, escaped] of decodedAliases) {
    const duplicate = '{' + JSON.stringify(key) + ': 1, "' + escaped + '": 2}'
    await privateJson(duplicate, async file =>
      assert.rejects(readBoundedRegularReviewedFixture(file), /Ambiguous or invalid reviewed fixture JSON/),
    )
  }
})

test('duplicate decoded property names are denied inside both arrays and deep nested source evidence', async () => {
  for (const depth of [0, 1, 2, 8, 16]) {
    for (const [key, escaped] of decodedAliases.slice(0, 4)) {
      let source = '{' + JSON.stringify(key) + ': 1, "' + escaped + '": 2}'
      for (let i = 0; i < depth; i++) source = '{"nested":[{"capture":' + source + '}]}'
      await privateJson(source, async file =>
        assert.rejects(readBoundedRegularReviewedFixture(file), /Ambiguous or invalid reviewed fixture JSON/),
      )
    }
  }
})

test('repeated names in distinct nested sibling objects are valid, not false-positive duplicates', async () => {
  for (const length of [1, 2, 8, 24]) {
    const original = {
      source: { supermarket: 'plus', capturedAt: '2026-10-04T18:00:00.000Z' },
      captures: Array.from({ length }, (_, i) => ({
        source: { supermarket: i % 2 ? 'dekamarkt' : 'plus' },
        offer: { offerPriceCents: i + 100, raw: '[{"source":"text"}]' },
      })),
    }
    await privateJson(JSON.stringify(original), async file =>
      assert.deepEqual(await readBoundedRegularReviewedFixture(file), original),
    )
  }
})

test('embedded object markers and colon characters inside strings do not create phantom JSON keys', async () => {
  const original = {
    source: { id: 'archived-source-only' },
    explanation: 'This is text: {"source":"other","capturedAt":"fake"} [}][{',
    message: String.raw`\"source\" : \"not a key\"`,
    sequence: [
      { field: 'one', metadata: '{"offerPriceCents":1}' },
      { field: 'two', metadata: '[{"capturedAt":"x"}]' },
    ],
  }
  await privateJson(JSON.stringify(original), async file =>
    assert.deepEqual(await readBoundedRegularReviewedFixture(file), original),
  )
})

test('actual JSON syntax errors still refuse without leaking content', async () => {
  for (const invalid of [
    '{"source": "truncated"',
    '{"source": 1,}',
    '{"capturedAt": "2026-10-04" "sha256": "x"}',
    '[{"source":1}',
    '{"price":NaN}',
    '{"price":Infinity}',
  ]) {
    await privateJson(invalid, async file =>
      assert.rejects(readBoundedRegularReviewedFixture(file), /Ambiguous or invalid reviewed fixture JSON/),
    )
  }
})
