import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'

const script = 'scripts/m3-create-observation-sheet.mjs'
const execute = (args = []) => spawnSync(process.execPath, [
  '--experimental-strip-types', script, ...args,
], { cwd: process.cwd(), encoding: 'utf8' })

test('M3 sheet stdout is parseable, template-only, and matches the canonical generator', () => {
  const result = execute()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout), buildObservationSheet())
  assert.match(result.stdout, /"collection-template-not-evidence"/)
  assert.ok(result.stdout.endsWith('\n'))
})

test('M3 sheet rejects malformed CLI arguments without emitting a partial template', () => {
  for (const args of [
    ['--output'],
    ['--output', '--help'],
    ['--output', ' leading-space.json'],
    ['--output', 'trailing-space.json '],
    ['unexpected'],
    ['--output', 'a.json', '--output', 'b.json'],
  ]) {
    const result = execute(args)
    assert.notEqual(result.status, 0, JSON.stringify(args))
    assert.equal(result.stdout, '', JSON.stringify(args))
    assert.match(result.stderr, /usage: m3:create-observation-sheet/, JSON.stringify(args))
  }
})

test('M3 sheet refuses to overwrite an existing observation without altering bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-no-clobber-'))
  const output = join(directory, 'observation.json')
  const sentinel = 'original user-observed evidence must survive\n'
  try {
    await writeFile(output, sentinel)
    const result = execute(['--output', output])
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /refusing to overwrite existing observation sheet/)
    assert.equal(await readFile(output, 'utf8'), sentinel)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 CLI template keeps demand identical for both retailers and observations unfilled', () => {
  const result = execute()
  assert.equal(result.status, 0, result.stderr)
  const sheet = JSON.parse(result.stdout)
  const expected = sheet.requirements.map(({ amount, unit }) => ({ amount, unit }))
  assert.equal(sheet.requirements.length, 11)
  for (const side of ['baseline', 'candidate']) {
    assert.deepEqual(sheet[side].lines.map(({ requirement }) => requirement), expected)
    assert.equal(sheet[side].evidenceId, '')
    assert.equal(sheet[side].observedAt, '')
    assert.equal(sheet[side].store.id, '')
    for (const line of sheet[side].lines) {
      assert.equal(line.observedProduct.priceCents, null)
      assert.equal(line.observedProduct.available, null)
    }
  }
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})

test('M3 CLI output is deterministic across independent invocations', () => {
  const first = execute()
  const second = execute()
  assert.equal(first.status, 0, first.stderr)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(first.stdout, second.stdout)
})
