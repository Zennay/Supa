import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeDerivedM3Output } from '../scripts/m3-source-output-preservation.mjs'

// All bytes and paths are synthetic. No real M3 field observations, prices or
// participant identities are read, written or logged by these tests.
async function scenario(callback) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-private-stage-race-'))
  const parent = join(root, 'report-dir')
  const input = join(root, 'fictional-input.json')
  const output = join(parent, 'assessment.json')
  await mkdir(parent)
  await writeFile(input, '{"fictional":true}\n', { mode: 0o600 })
  await writeFile(output, 'OLD_REPORT_COMPLETE\n', { mode: 0o600 })
  try {
    await callback({ root, parent, input, output })
    assert.equal(await readFile(input, 'utf8'), '{"fictional":true}\n')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

async function stagedName(parent) {
  const names = (await readdir(parent)).filter(name => name.endsWith('.m3-tmp'))
  assert.equal(names.length, 1, 'exactly one private staging file created')
  return names[0]
}

test('M3 moved parent symlink must not delete an unrelated file during interrupted cleanup', () =>
  scenario(async ({ root, parent, input, output }) => {
    const originalParent = join(root, 'moved-original-parent')
    const unrelated = join(root, 'unrelated-private-directory')
    await mkdir(unrelated)
    let injectedName
    async function* switchedParent() {
      yield 'PARTIAL_PRIVATE_RESULT'
      injectedName = await stagedName(parent)
      await rename(parent, originalParent)
      await symlink(unrelated, parent, 'dir')
      await writeFile(join(unrelated, injectedName), 'UNRELATED_MUST_SURVIVE\n')
      throw new Error('SYNTHETIC_INTERRUPTED_AFTER_PARENT_SWAP')
    }
    await assert.rejects(
      writeDerivedM3Output(input, output, switchedParent()),
      /SYNTHETIC_INTERRUPTED_AFTER_PARENT_SWAP/,
    )
    assert.equal(await readFile(join(unrelated, injectedName), 'utf8'), 'UNRELATED_MUST_SURVIVE\n')
    assert.equal(await readFile(join(originalParent, 'assessment.json'), 'utf8'), 'OLD_REPORT_COMPLETE\n')
    assert.equal((await stat(join(originalParent, injectedName))).isFile(), true,
      'original staged inode remains at moved parent; cannot safely path-unlink it')
  }))

test('M3 directory replacement must refuse report publication and preserve replacement files', () =>
  scenario(async ({ root, parent, input, output }) => {
    const oldParent = join(root, 'original-parent')
    let injectedName
    async function* replacedParent() {
      yield 'FIRST_PART'
      injectedName = await stagedName(parent)
      await rename(parent, oldParent)
      await mkdir(parent)
      await writeFile(join(parent, injectedName), 'NEW_PARENT_PRIVATE_SENTINEL\n')
      yield '_SECOND_PART'
    }
    await assert.rejects(
      writeDerivedM3Output(input, output, replacedParent()),
      /M3 output parent changed during private report publication/,
    )
    assert.equal(await readFile(join(oldParent, 'assessment.json'), 'utf8'), 'OLD_REPORT_COMPLETE\n')
    assert.equal(await readFile(join(parent, injectedName), 'utf8'), 'NEW_PARENT_PRIVATE_SENTINEL\n')
    await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' })
  }))

test('M3 staging filename replacement must not become a forged final report', () =>
  scenario(async ({ parent, input, output }) => {
    let originalStaging
    let stage
    async function* overwrittenStagingName() {
      yield 'ORIGINAL_FIRST_PART'
      stage = await stagedName(parent)
      originalStaging = join(parent, 'moved-staging-original')
      await rename(join(parent, stage), originalStaging)
      await writeFile(join(parent, stage), 'FORGED_INSTEAD_OF_REAL\n')
      yield '_ORIGINAL_LAST_PART'
    }
    await assert.rejects(
      writeDerivedM3Output(input, output, overwrittenStagingName()),
      /M3 staging file changed before report publication/,
    )
    assert.equal(await readFile(output, 'utf8'), 'OLD_REPORT_COMPLETE\n')
    assert.equal(await readFile(join(parent, stage), 'utf8'), 'FORGED_INSTEAD_OF_REAL\n')
    assert.equal(await readFile(originalStaging, 'utf8'), 'ORIGINAL_FIRST_PART_ORIGINAL_LAST_PART')
  }))

test('M3 failed generator must not delete a substituted staging pathname', () =>
  scenario(async ({ parent, input, output }) => {
    let stage
    async function* interruptedSwappedStagingName() {
      yield 'FIRST_STAGE'
      stage = await stagedName(parent)
      await rename(join(parent, stage), join(parent, 'saved-staging-original'))
      await writeFile(join(parent, stage), 'PRIVATE_UNRELATED_DATA\n')
      throw new Error('SYNTHETIC_SERIALIZATION_FAILED')
    }
    await assert.rejects(
      writeDerivedM3Output(input, output, interruptedSwappedStagingName()),
      /SYNTHETIC_SERIALIZATION_FAILED/,
    )
    assert.equal(await readFile(output, 'utf8'), 'OLD_REPORT_COMPLETE\n')
    assert.equal(await readFile(join(parent, stage), 'utf8'), 'PRIVATE_UNRELATED_DATA\n')
  }))

test('M3 ordinary interrupted report still removes its own staged file', () =>
  scenario(async ({ parent, input, output }) => {
    async function* interrupted() {
      yield 'SYNTHETIC_PARTIAL'
      throw new Error('EXPECTED_SYNTHETIC_FAILURE')
    }
    await assert.rejects(writeDerivedM3Output(input, output, interrupted()), /EXPECTED_SYNTHETIC_FAILURE/)
    assert.equal(await readFile(output, 'utf8'), 'OLD_REPORT_COMPLETE\n')
    assert.deepEqual((await readdir(parent)).sort(), ['assessment.json'])
  }))
