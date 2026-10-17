import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, link, lstat, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

// Independent 3x7 Linux-file privacy matrix for the *actual* opt-in M3 QA
// operator CLI; complementary to financial and field SHA oracle tests.
// All artifacts are fictional synthetic data, never store observations.
// Failure responses must not disclose paths, raw JSON, prices or pins.
const ENTRY = fileURLToPath(new URL(
  '../scripts/qa-m3-field-run-code-pin-cli-20261017.mjs', import.meta.url))
const SHA = 'a'.repeat(40)
const TOKEN = 'fictional-secret-canary-20261017'
const REFUSAL = 'M3 private field-run pin proof refused\n'
const run = args => spawnSync(process.execPath,
  ['--experimental-strip-types', ENTRY, ...args],
  { encoding: 'utf8', timeout: 10000 })

function refuses(output, label) {
  assert.notEqual(output.status, 0, label)
  assert.equal(output.stdout, '', label + ' no partial proof')
  assert.equal(output.stderr, REFUSAL, label + ' exact generic error')
  assert.doesNotMatch(output.stderr, /[a-f0-9]{40}|participant|canary|\.json|PLUS|DekaMarkt/iu)
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-pin-three-files-'))
  await chmod(dir, 0o700)
  const sheet = buildFictionalPricedSheet(90)
  sheet.study.participantKey = TOKEN
  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const report = buildObservedWeekReport(study)
  sheet.study.fieldRunCommitSha = SHA
  study.fieldRunCommitSha = SHA
  report.fieldRunCommitSha = SHA
  const paths = ['sheet.json', 'study.json', 'assessment.json']
    .map(name => join(dir, name))
  for (const [i, value] of [sheet, study, report].entries()) {
    await writeFile(paths[i], JSON.stringify(value), { mode: 0o600 })
  }
  const argsFor = positions => [
    '--sheet', positions[0], '--study', positions[1],
    '--assessment', positions[2], '--expected-main-sha', SHA,
  ]
  return { dir, paths, argsFor }
}

test('each of three M3 pinned private input files refuses 7 hostile disk transports and preserves original bytes', async () => {
  const f = await fixture()
  let checked = 0
  try {
    const positive = run(f.argsFor(f.paths))
    assert.equal(positive.status, 0, positive.stderr)
    assert.equal(JSON.parse(positive.stdout).codePinMatched, true)
    assert.equal(JSON.parse(positive.stdout).m3ExitProven, false)

    for (const i of [0, 1, 2]) {
      const file = f.paths[i]
      const original = await readFile(file)
      const descriptor = await lstat(file)
      assert.equal(descriptor.mode & 0o777, 0o600)
      const check = label => {
        refuses(run(f.argsFor(f.paths)), 'file ' + i + ': ' + label)
        checked++
      }

      try {
        await chmod(file, 0o644)
        check('world-readable 0644')
      } finally { await chmod(file, 0o600) }

      try {
        await chmod(file, 0o640)
        check('group-readable 0640')
      } finally { await chmod(file, 0o600) }

      const hard = file + '.hardlink'
      try {
        await link(file, hard)
        check('two-link hardlinked inode')
      } finally { await rm(hard, { force: true }) }

      const aliasDir = join(f.dir, 'symlink-parent')
      try {
        await symlink(f.dir, aliasDir)
        const aliasPaths = [...f.paths]
        aliasPaths[i] = join(aliasDir, ['sheet.json', 'study.json', 'assessment.json'][i])
        refuses(run(f.argsFor(aliasPaths)), 'file ' + i + ': symlink ancestor')
        checked++
      } finally { await rm(aliasDir, { force: true }) }

      try {
        const text = original.toString('utf8')
        assert.ok(text.includes('"schemaVersion":1,'))
        await writeFile(file, text.replace('"schemaVersion":1,',
          '"schemaVersion":1,"schemaVersion":1,'), { mode: 0o600 })
        check('duplicate top-level JSON key')
      } finally { await writeFile(file, original, { mode: 0o600 }) }

      try {
        await writeFile(file, Buffer.from([0xff, 0xfe, 0x00]), { mode: 0o600 })
        check('invalid UTF-8')
      } finally { await writeFile(file, original, { mode: 0o600 }) }

      try {
        await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1, 0x58), { mode: 0o600 })
        check('over 2MiB private JSON limit')
      } finally { await writeFile(file, original, { mode: 0o600 }) }

      assert.deepEqual(await readFile(file), original,
        'test mutations must never leave private artifacts modified')
    }
    assert.equal(checked, 21)
    const after = run(f.argsFor(f.paths))
    assert.equal(after.status, 0, 'original private three-way proof remains usable')
    const proof = JSON.parse(after.stdout)
    assert.equal(proof.codePinMatched, true)
    assert.equal(proof.publicSavingsClaimEligible, false)
    assert.equal(proof.verifiedRetailerObservations, false)
  } finally {
    await rm(f.dir, { recursive: true, force: true })
  }
})
