import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { readPrivateM3ActionDraft } from '../scripts/m3-private-field-actions-input.mjs'

const cli = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const secret = 'SECRET_PRIVATE_M3_PARTICIPANT_REFERENCE'
const run = (cwd, path, ...flags) => spawnSync(
  process.execPath, ['--experimental-strip-types', cli, path, ...flags],
  { cwd, encoding: 'utf8', timeout: 20_000 },
)

async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-private-input-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const sheet = buildObservationSheet()
  sheet.study.participantKey = secret
  const path = join(dir, 'private-draft.json')
  const input = JSON.stringify(sheet)
  await writeFile(path, input, { mode: 0o600 })
  return { dir, path, input }
}

function refusal(runResult, dir) {
  assert.equal(runResult.error, undefined, runResult.error?.message)
  assert.notEqual(runResult.status, 0)
  assert.equal(runResult.stdout, '')
  assert.equal(runResult.stderr.includes(secret), false)
  assert.equal(runResult.stderr.includes(dir), false)
  assert.equal(runResult.stderr.includes('private-draft.json'), false)
}

test('canonical private 0600 M3 draft still produces safe JSON and human checklist', async t => {
  const { dir, path, input } = await sandbox(t)
  assert.equal(await readPrivateM3ActionDraft(path), input)
  for (const opts of [[], ['--text']]) {
    const result = run(dir, path, ...opts)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout.includes(secret), false)
    if (opts.length === 0) {
      const report = JSON.parse(result.stdout)
      assert.equal(report.expectedTotalLines, 22)
      assert.equal(report.publicSavingsClaimEligible, false)
    } else {
      assert.match(result.stdout, /nog te meten/)
      assert.match(result.stdout, /Bloemkool \(2 stuks\)/)
      assert.doesNotMatch(result.stdout, /\bpiece\b/)

      assert.equal(result.stdout.includes(secret), false)
    }
  }
  assert.equal(await readFile(path, 'utf8'), input, 'never mutate original source')
})

test('private action CLI refuses symlink file and symlink ancestor without exposing source', async t => {
  const { dir, path } = await sandbox(t)
  const target = join(dir, 'linked.json')
  await symlink(path, target)
  refusal(run(dir, target), dir)
  const realParent = join(dir, 'private-parent')
  const aliasParent = join(dir, 'aliased-parent')
  await mkdir(realParent)
  const nested = join(realParent, 'copy.json')
  await writeFile(nested, await readFile(path), { mode: 0o600 })
  await symlink(realParent, aliasParent, 'dir')
  refusal(run(dir, join(aliasParent, 'copy.json'), '--text'), dir)
})

test('private action CLI refuses world-readable, group-readable and multiply linked files', async t => {
  const { dir, path } = await sandbox(t)
  for (const unsafeMode of [0o640, 0o644]) {
    await chmod(path, unsafeMode)
    refusal(run(dir, path), dir)
  }
  await chmod(path, 0o600)
  const hardlink = join(dir, 'linked-hard.json')
  await link(path, hardlink)
  refusal(run(dir, path), dir)
  refusal(run(dir, hardlink), dir)
})

test('private action CLI refuses overlarge input before parsing, without altering source', async t => {
  const { dir, path } = await sandbox(t)
  const oversized = 'X'.repeat(2 * 1024 * 1024 + 1)
  await writeFile(path, oversized, { mode: 0o600 })
  refusal(run(dir, path), dir)
  await assert.rejects(() => readPrivateM3ActionDraft(path), /unsafe/)
  assert.equal((await readFile(path, 'utf8')).length, oversized.length)
})

test('private action input parser refuses flags and filenames with whitespace before I/O', async () => {
  for (const path of ['', '  ', '--text', 'file.json ', ' file.json']) {
    await assert.rejects(() => readPrivateM3ActionDraft(path), /unsafe/)
  }
})
