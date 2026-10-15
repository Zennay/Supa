import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildM3FieldKit,
  writeM3FieldKit,
} from '../scripts/m3-prepare-field-kit.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// All files are UNFILLED fictional operator paperwork; no retailer HTTP,
// participants, prices, consent or real observed study is ever synthesized.
const FAKE_MAIN_SHA = 'a'.repeat(40)
const revision = () => ({ branch: 'main', sha: FAKE_MAIN_SHA })

test('private field kit derives the exact current canonical 11 + 11 requirements without a price', () => {
  const kit = buildM3FieldKit(revision())
  assert.deepEqual(Object.keys(kit).sort(), [
    'START-HERE.txt', 'collection-sheet.json', 'field-form.html', 'source-revision.json',
  ].sort())
  const sheet = JSON.parse(kit['collection-sheet.json'])
  const canonical = buildObservationSheet()
  assert.deepEqual(sheet, canonical)
  assert.equal(sheet.requirements.length, 11)
  for (const side of ['baseline', 'candidate']) {
    assert.deepEqual(sheet[side].lines.map((row) => row.ingredientId),
      sheet.requirements.map((requirement) => requirement.id))
    for (const row of sheet[side].lines) {
      assert.equal(row.observedProduct.available, null)
      assert.equal(row.observedProduct.priceCents, null)
      assert.equal(row.observedProduct.productName, '')
    }
  }
  assert.match(kit['field-form.html'], /data-m3-side="baseline"/u)
  assert.match(kit['field-form.html'], /data-m3-side="candidate"/u)
  assert.equal((kit['field-form.html'].match(/data-m3-row="/gu) || []).length, 22)
})

test('kit commits current main pin and stable canonical demand checksum as companion ONLY', () => {
  const kit = buildM3FieldKit(revision())
  const pin = JSON.parse(kit['source-revision.json'])
  assert.equal(pin.sourceBranch, 'main')
  assert.equal(pin.sourceCommitSha, FAKE_MAIN_SHA)
  assert.match(pin.canonicalDemandSha256, /^[0-9a-f]{64}$/u)
  assert.equal(pin.verifiedRetailerObservations, false)
  assert.equal(pin.publicSavingsClaimEligible, false)
  assert.equal(pin.evidenceStatus, 'collection-kit-not-evidence')
  assert.match(pin.notice, /Issue #205/u)
  assert.match(kit['START-HERE.txt'], /issue #205/u)
  assert.match(kit['START-HERE.txt'], /#78/u)
  assert.match(kit['START-HERE.txt'], /#74/u)
  assert.ok(!Object.hasOwn(JSON.parse(kit['collection-sheet.json']).study, 'sourceCommitSha'),
    'companion provenance is not falsely represented as persisted inside study schema')
})

test('wrong branch, short or spoofed revision can never create an attested kit', () => {
  for (const invalid of [
    null, {}, { branch: 'feature', sha: FAKE_MAIN_SHA },
    { branch: 'main', sha: 'abc' },
    { branch: 'main', sha: 'A'.repeat(40) },
    { branch: 'main', sha: 'g'.repeat(40) },
    { branch: 'main', sha: new String(FAKE_MAIN_SHA) },
  ]) {
    assert.throws(() => buildM3FieldKit(invalid), /clean main checkout/u)
  }
})

test('two identical main pins produce a byte-identical deterministic empty operator bundle', () => {
  assert.deepEqual(buildM3FieldKit(revision()), buildM3FieldKit(revision()))
  assert.notDeepEqual(buildM3FieldKit(revision()),
    buildM3FieldKit({ branch: 'main', sha: 'b'.repeat(40) }))
})

test('private kit writes four new 0600 files into exclusive 0700 directory and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-kit-'))
  try {
    const destination = join(root, 'private-field-visit')
    const kit = buildM3FieldKit(revision())
    const result = await writeM3FieldKit(destination, kit)
    assert.equal(result.sourceCommitSha, FAKE_MAIN_SHA)
    assert.equal(result.files.length, 4)
    assert.equal((await lstat(destination)).mode & 0o777, 0o700)
    for (const name of result.files) {
      assert.equal((await lstat(join(destination, name))).mode & 0o777, 0o600)
      assert.equal(await readFile(join(destination, name), 'utf8'), kit[name])
    }
    assert.deepEqual(JSON.parse(await readFile(join(destination, 'collection-sheet.json'), 'utf8')),
      buildObservationSheet())
    await assert.rejects(writeM3FieldKit(destination, kit))
    assert.equal(await readFile(join(destination, 'START-HERE.txt'), 'utf8'), kit['START-HERE.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('existing destination files and symlinked parent aliases never become kit targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-existing-'))
  try {
    const occupied = join(root, 'occupied')
    await writeFile(occupied, 'KEEP ME', 'utf8')
    const kit = buildM3FieldKit(revision())
    await assert.rejects(writeM3FieldKit(occupied, kit))
    assert.equal(await readFile(occupied, 'utf8'), 'KEEP ME')
    const realParent = join(root, 'real')
    await mkdir(realParent)
    const alias = join(root, 'shortcut')
    await symlink(realParent, alias, 'dir')
    await assert.rejects(writeM3FieldKit(join(alias, 'new'), kit),
      /symlinked M3 output parent/u)
    assert.deepEqual(await (await import('node:fs/promises')).readdir(realParent), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('blank kit rejects malformed destinations or incomplete data before writing anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-invalid-'))
  try {
    const kit = buildM3FieldKit(revision())
    for (const path of ['', '  ', '-nope', 'bad\u0000path', 'bad\npath']) {
      await assert.rejects(writeM3FieldKit(path, kit))
    }
    await assert.rejects(writeM3FieldKit(join(root, 'invalid'), {
      'collection-sheet.json': '{}',
    }), /incomplete blank M3 field kit/u)
    const { readdir } = await import('node:fs/promises')
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('npm field kit command uses local offline generator without contacting retailer', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts['m3:prepare-field-kit'],
    'node --experimental-strip-types scripts/m3-prepare-field-kit.mjs')
})
