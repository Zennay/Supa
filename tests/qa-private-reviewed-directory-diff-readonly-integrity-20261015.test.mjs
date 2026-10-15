import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { compareReviewedDirectories, main } from '../scripts/retailer-private-reviewed-directory-diff.mjs'

/*
 * Independent positive and negative file-preservation contract for the exact
 * private, historical six-shape reviewed directory-comparison entry point.
 * No real observed prices, network calls, operator permissions or live sources.
 */

const at = '2026-10-15T21:00:00.000Z'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function makeReviewedDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-readonly-directory-diff-'))
  try {
    const manifest = {
      schemaVersion: 1,
      mode: 'private-reviewed-retailer-batch',
      productionEnabled: false,
      permissionVerified: false,
      publicSavingsClaimEligible: false,
      sources: [],
    }
    for (const file of RETAILER_REVIEWED_FIXTURES) {
      const bytes = await readFile(new URL('../fixtures/m1/' + file, import.meta.url))
      const record = JSON.parse(bytes.toString('utf8'))
      const name = `capture-${manifest.sources.length}.json`
      await writeFile(join(directory, name), bytes, { flag: 'wx', mode: 0o600 })
      manifest.sources.push({
        file: name,
        sha256: sha256(bytes),
        key: `${record.source.supermarket}:${record.source.kind}`,
      })
    }
    assert.equal(manifest.sources.length, 6)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest) + '\n',
      { flag: 'wx', mode: 0o600 })
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function fingerprint(directory) {
  const root = await lstat(directory, { bigint: true })
  const names = (await readdir(directory)).sort()
  const files = []
  for (const name of names) {
    const path = join(directory, name)
    const info = await lstat(path, { bigint: true })
    files.push({
      name,
      digest: sha256(await readFile(path)),
      size: String(info.size),
      mode: String(info.mode),
      inode: String(info.ino),
      links: String(info.nlink),
      mtimeNs: String(info.mtimeNs),
    })
  }
  return {
    names,
    rootMode: String(root.mode),
    rootInode: String(root.ino),
    files,
  }
}

test('QA: repeated reviewed-directory API and real CLI are byte/inode/mode/mtime read-only', async () => {
  const before = await makeReviewedDirectory()
  const after = await makeReviewedDirectory()
  try {
    const expectedBefore = await fingerprint(before)
    const expectedAfter = await fingerprint(after)
    const first = await compareReviewedDirectories(before, after, { referenceTime: at })
    const second = await compareReviewedDirectories(before, after, { referenceTime: at })
    assert.deepEqual(second, first)
    assert.ok(first.comparedProducts > 0)
    assert.equal(first.productionEnabled, false)
    assert.equal(first.sourceRightsVerified, false)
    assert.equal(first.livePricesAvailable, false)
    assert.equal(first.publicSavingsClaimEligible, false)
    assert.equal(first.externalRequests, 0)
    let printed = ''
    const cli = await main(['--before-dir', before, '--after-dir', after, '--at', at],
      chunk => { printed += chunk })
    assert.deepEqual(cli, first)
    assert.deepEqual(JSON.parse(printed), first)
    assert.doesNotMatch(printed, /capture-|www\.plus\.nl|halfvolle/iu)
    assert.equal(printed.includes(before), false)
    assert.equal(printed.includes(after), false)
    assert.deepEqual(await fingerprint(before), expectedBefore)
    assert.deepEqual(await fingerprint(after), expectedAfter)
  } finally {
    await Promise.all([before, after].map(dir => rm(dir, { recursive: true, force: true })))
  }
})

test('QA: world-readable rejected private evidence is not silently rewritten or repaired', async () => {
  const before = await makeReviewedDirectory()
  const after = await makeReviewedDirectory()
  try {
    await chmod(join(after, 'capture-0.json'), 0o644)
    const expectedBefore = await fingerprint(before)
    const expectedAfter = await fingerprint(after)
    let writes = 0
    await assert.rejects(
      main(['--before-dir', before, '--after-dir', after, '--at', at],
        () => { writes++ }),
      /Private retailer reviewed directory diff refused/u,
    )
    assert.equal(writes, 0)
    assert.deepEqual(await fingerprint(before), expectedBefore)
    assert.deepEqual(await fingerprint(after), expectedAfter)
  } finally {
    await Promise.all([before, after].map(dir => rm(dir, { recursive: true, force: true })))
  }
})
