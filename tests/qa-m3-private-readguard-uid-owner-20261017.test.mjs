import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// QA-only independent regression atop the existing guarded draft reader.
// No privilege escalation, chown, sudo, user secrets or live records:
// a private regular file is created under the ordinary runner identity.
// A fresh child overrides process.getuid ONLY to simulate a file from a
// different local owner without mutating actual filesystem ownership.
// This is a validation logic probe, NOT proof of a real cross-user exploit.
const SCRIPT = new URL('../scripts/qa-m3-private-field-progress-readguard-20261017.mjs', import.meta.url).href
const CANARY = 'FICTIONAL_PRIVATE_OWNER_CANARY_NEVER_PRINT'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-m3-owner-admission-'))
  const privateDir = join(root, 'private')
  await mkdir(privateDir, { mode: 0o700 })
  const file = join(privateDir, 'field.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = CANARY
  await writeFile(file, JSON.stringify(sheet), { mode: 0o600 })
  t.after(() => rm(root, { force: true, recursive: true }))
  return file
}

function readInIdentityModel(file, simulatedUid) {
  const script = `
    import { safePrivateM3Progress } from ${JSON.stringify(SCRIPT)}
    Object.defineProperty(process, 'getuid', {
      configurable: true,
      value: () => ${Number(simulatedUid)},
    })
    try {
      const report = await safePrivateM3Progress(process.argv[1])
      if (report?.evidenceStatus !== 'unverified-operator-draft' ||
          report?.publicSavingsClaimEligible !== false ||
          report?.verifiedRetailerObservations !== false) throw new Error('unsafe report')
      process.stdout.write('ACCEPTED\\n')
    } catch {
      process.stdout.write('REFUSED\\n')
    }
  `
  const child = spawnSync(process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script, file], {
      encoding: 'utf8',
      timeout: 10000,
    })
  assert.equal(child.error, undefined, 'the synthetic child process must finish')
  assert.equal(child.status, 0, 'the synthetic probe should exit cleanly')
  assert.equal(child.stderr, '')
  assert.ok(!child.stdout.includes(CANARY), 'never echo simulated private owner data')
  assert.ok(!child.stdout.includes(file), 'never echo private source paths')
  return child.stdout
}

test('positive: guarded operator reader accepts an owner-only 0600 canonical draft under its real UID', async t => {
  if (typeof process.getuid !== 'function') return t.skip('POSIX UID model required')
  const file = await fixture(t)
  assert.equal(readInIdentityModel(file, process.getuid()), 'ACCEPTED\\n')
})

test('P1 #3785: guarded operator reader must not trust private 0600 files owned by a different UID', async t => {
  if (typeof process.getuid !== 'function') return t.skip('POSIX UID model required')
  const file = await fixture(t)
  const foreignUid = process.getuid() === 0 ? 1 : 0
  assert.notEqual(foreignUid, process.getuid())
  assert.equal(readInIdentityModel(file, foreignUid), 'REFUSED\\n',
    'a readable private FD and mode 0600 do not establish that this process owns the evidence')
})
