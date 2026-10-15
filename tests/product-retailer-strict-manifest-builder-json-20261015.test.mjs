import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateReviewedManifest } from '../scripts/retailer-private-reviewed-manifest-builder.mjs'
import { replayPrivateReviewedCaptureDirectory } from '../scripts/retailer-private-reviewed-manifest-replay.mjs'

const runner = new URL('../scripts/retailer-private-reviewed-manifest-builder.mjs', import.meta.url).pathname
async function withFiles(run) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-product-builder-unique-json-'))
  try {
    await chmod(dir, 0o700)
    for (const [i, name] of RETAILER_REVIEWED_FIXTURES.entries()) {
      const bytes = await readFile(new URL('../fixtures/m1/' + name, import.meta.url))
      await writeFile(join(dir, 'capture-' + i + '.json'), bytes,
        { flag: 'wx', mode: 0o600 })
    }
    await run(dir)
  } finally { await rm(dir, { recursive: true, force: true }) }
}
async function deniedMutant(mutate, selectedIndex = 0) {
  await withFiles(async dir => {
    const path = join(dir, 'capture-' + selectedIndex + '.json')
    const original = await readFile(path, 'utf8')
    const tampered = mutate(original)
    assert.notEqual(tampered, original)
    assert.deepEqual(JSON.parse(tampered), JSON.parse(original),
      'last-wins parse remains equivalent; duplicate raw provenance must still be refused')
    assert.equal(createHash('sha256').update(tampered).digest('hex').length, 64)
    await writeFile(path, tampered, { mode: 0o600 })
    await assert.rejects(buildPrivateReviewedManifest(dir), /Private reviewed manifest builder refused/)
    assert.ok(!(await readdir(dir)).includes('manifest.json'))
  })
}
const add = (s, needle, extra) => {
  assert.ok(s.includes(needle))
  return s.replace(needle, extra + needle)
}

test('owner-only six reviewed historical sources still generate SHA manifest and replay privately', () =>
  withFiles(async dir => {
    const made = await buildPrivateReviewedManifest(dir)
    const replayed = await replayPrivateReviewedCaptureDirectory(dir)
    assert.equal(made.filesPinned, 6)
    assert.equal(replayed.acceptedSources, 6)
    assert.equal(replayed.externalRequests, 0)
    assert.equal(replayed.publicSavingsClaimEligible, false)
    assert.equal(replayed.permissionVerified, false)
  }))

test('builder refuses raw repeated version with untouched effective value', () =>
  deniedMutant(s => add(s, '"version": 1,', '"version": 998, ')))

test('builder refuses raw repeated retailer identity', () =>
  deniedMutant(s => add(s, '"supermarket": "plus",',
    '"supermarket": "dekamarkt", ')))

test('builder refuses raw repeated nested anti-bot exemption', () =>
  deniedMutant(s => add(s, '"antiBotBypass": false',
    '"antiBotBypass": true, ')))

test('builder refuses escaped spelling of existing version key', () =>
  deniedMutant(s => add(s, '"version": 1,',
    '"\\u0076ersion": 998, ')))

test('builder checks final sixth staged evidence file, not just first five', () =>
  deniedMutant(s => add(s, '"version": 1,', '"version": 998, '), 5))

test('builder CLI rejects ambiguous reviewed capture without emitting a success manifest', () =>
  withFiles(async dir => {
    const path = join(dir, 'capture-0.json')
    const original = await readFile(path, 'utf8')
    await writeFile(path, add(original, '"version": 1,', '"version": 998, '),
      { mode: 0o600 })
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', runner, '--dir', dir],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 })
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Private reviewed manifest builder refused\s*$/)
    assert.equal(result.stderr.includes(dir), false)
    assert.ok(!(await readdir(dir)).includes('manifest.json'))
  }))
