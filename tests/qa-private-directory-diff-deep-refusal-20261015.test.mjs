import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  link, lstat, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  compareReviewedDirectories, main,
} from '../scripts/retailer-private-reviewed-directory-diff.mjs'

/**
 * Independent QA only. Exercise actual historical six-shape, SHA-pinned,
 * 0600 local evidence files. Never query retailers, grant rights, emit real
 * prices, copy private archives to the repository, or modify product code.
 */
const CLOCK = '2026-10-15T21:00:00.000Z'
const REFUSAL = 'Private retailer reviewed directory diff refused'
const DIGEST = bytes => createHash('sha256').update(bytes).digest('hex')
const script = new URL('../scripts/retailer-private-reviewed-directory-diff.mjs', import.meta.url).pathname

async function archived() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-private-failure-marker-'))
  try {
    const manifest = {
      schemaVersion: 1, mode: 'private-reviewed-retailer-batch',
      productionEnabled: false, permissionVerified: false,
      publicSavingsClaimEligible: false, sources: [],
    }
    for (const original of RETAILER_REVIEWED_FIXTURES) {
      const bytes = await readFile(new URL('../fixtures/m1/' + original, import.meta.url))
      const raw = JSON.parse(bytes.toString('utf8'))
      const file = `capture-${manifest.sources.length}.json`
      await writeFile(join(dir, file), bytes, { flag: 'wx', mode: 0o600 })
      manifest.sources.push({
        file, sha256: DIGEST(bytes),
        key: `${raw.source.supermarket}:${raw.source.kind}`,
      })
    }
    assert.equal(manifest.sources.length, 6)
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest) + '\n',
      { flag: 'wx', mode: 0o600 })
    return dir
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

async function fingerprint(dir) {
  const names = (await readdir(dir)).sort()
  const files = []
  for (const name of names) {
    const info = await lstat(join(dir, name), { bigint: true })
    files.push({
      name, sha: DIGEST(await readFile(join(dir, name))),
      inode: String(info.ino), links: String(info.nlink),
      mode: String(info.mode), bytes: String(info.size),
      mtimeNs: String(info.mtimeNs),
    })
  }
  return files
}

async function checkRefusal(first, second, referenceTime = CLOCK) {
  const frozenA = await fingerprint(first)
  const frozenB = await fingerprint(second)
  await assert.rejects(
    compareReviewedDirectories(first, second, { referenceTime }),
    error => {
      assert.equal(error.message, REFUSAL)
      assert.equal(error.message.includes(first), false)
      assert.equal(error.message.includes(second), false)
      return true
    },
  )
  let chunks = ''
  await assert.rejects(
    main(['--before-dir', first, '--after-dir', second, '--at', referenceTime],
      text => { chunks += text }),
    error => error.message === REFUSAL,
  )
  assert.equal(chunks, '', 'programmatic CLI must not print partial evidence')
  const actual = spawnSync(process.execPath, [
    '--experimental-strip-types', script,
    '--before-dir', first, '--after-dir', second, '--at', referenceTime,
  ], { encoding: 'utf8', timeout: 15_000 })
  assert.equal(actual.status, 2)
  assert.equal(actual.stdout, '')
  assert.equal(actual.stderr.trim(), REFUSAL)
  assert.equal(actual.stderr.includes(first), false)
  assert.equal(actual.stderr.includes(second), false)
  assert.deepEqual(await fingerprint(first), frozenA)
  assert.deepEqual(await fingerprint(second), frozenB)
}

test('QA: two genuine historical six-shape private archives compare without source disclosure', async () => {
  const first = await archived()
  const second = await archived()
  try {
    const frozenA = await fingerprint(first)
    const frozenB = await fingerprint(second)
    const result = await compareReviewedDirectories(first, second, { referenceTime: CLOCK })
    assert.ok(result.comparedProducts > 0)
    assert.equal(result.mode, 'private-historical-retailer-fact-change-review')
    assert.equal(result.productionEnabled, false)
    assert.equal(result.sourceRightsVerified, false)
    assert.equal(result.livePricesAvailable, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.externalRequests, 0)
    assert.equal(JSON.stringify(result).includes(first), false)
    assert.equal(JSON.stringify(result).includes(second), false)
    assert.equal(JSON.stringify(result).includes('www.plus.nl'), false)
    assert.deepEqual(await fingerprint(first), frozenA)
    assert.deepEqual(await fingerprint(second), frozenB)
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})

test('QA: SHA tampered captured bytes refuse privately with no partial writes or recovery', async () => {
  const first = await archived()
  const second = await archived()
  try {
    await writeFile(join(second, 'capture-0.json'), '{"secret-marker":"not-authenticated"}\n')
    await checkRefusal(first, second)
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})

test('QA: duplicate manifest object key remains ambiguous despite unchanged private file mode', async () => {
  const first = await archived()
  const second = await archived()
  try {
    const manifest = join(second, 'manifest.json')
    const original = await readFile(manifest, 'utf8')
    assert.match(original, /^{"schemaVersion":1,/)
    await writeFile(manifest, original.replace(
      /^{"schemaVersion":1,/, '{"schemaVersion":1,"schemaVersion":1,',
    ))
    await checkRefusal(first, second)
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})

test('QA: hardlinked evidence never counts as a privately independent 0600 source', async () => {
  const first = await archived()
  const second = await archived()
  try {
    await link(join(second, 'capture-0.json'), join(second, 'capture-linked-copy.json'))
    await checkRefusal(first, second)
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})

test('QA: backdated operator audit clock cannot turn later reviewed capture into historical evidence', async () => {
  const first = await archived()
  const second = await archived()
  try {
    await checkRefusal(first, second, '2000-01-01T00:00:00Z')
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})


test('QA: manifest-pinned malformed UTF-8 source is refused even with matching SHA-256', async () => {
  const first = await archived()
  const second = await archived()
  try {
    const malformed = Buffer.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0xff, 0x7d])
    await writeFile(join(second, 'capture-0.json'), malformed)
    const path = join(second, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.sources[0].sha256 = DIGEST(malformed)
    await writeFile(path, JSON.stringify(manifest) + '\n')
    assert.equal(manifest.sources[0].sha256, DIGEST(await readFile(join(second, 'capture-0.json'))))
    await checkRefusal(first, second)
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})

test('QA: impossible audit calendar date refuses without touching valid private archives', async () => {
  const first = await archived()
  const second = await archived()
  try {
    await checkRefusal(first, second, '2026-02-30T12:00:00Z')
  } finally {
    await Promise.all([first, second].map(dir => rm(dir, { recursive: true, force: true })))
  }
})
