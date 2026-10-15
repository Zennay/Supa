import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPrivateM3StudyCodePin, verifyPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'

// Offline synthetic-only QA on immutable owner #2837 c897c57fcb7493c195777d0fb7f3fe1e33297672.
const SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
const PRIVATE_ID = 'fictional-m3-private-output-marker'
const study = Buffer.from(JSON.stringify({
  schemaVersion: 1,
  studyId: PRIVATE_ID,
  baseline: { sample: 'fictional-plus' },
  candidate: { sample: 'fictional-dekamarkt' },
}))

function save(source, destination) {
  return spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', source, SHA, '--output', destination], {
    encoding: 'utf8',
    timeout: 3000,
  })
}

async function fixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-qa-m3-output-'))
  try {
    const source = join(directory, 'private-study.json')
    const destination = join(directory, 'private-code-pin.json')
    await writeFile(source, study, { mode: 0o600 })
    await callback({ source, destination })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('M3 --output writes one private immutable manifest and does not overwrite source evidence', async () => {
  await fixture(async ({ source, destination }) => {
    const first = save(source, destination)
    assert.equal(first.status, 0, String(first.error || first.stderr))
    assert.equal(first.stdout.includes(PRIVATE_ID), false)
    assert.equal(first.stderr.includes(PRIVATE_ID), false)
    const stored = await readFile(destination)
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(stored.toString()), createPrivateM3StudyCodePin(study, SHA))
    assert.equal(verifyPrivateM3StudyCodePin(study, JSON.parse(stored.toString())), true)
    assert.equal(first.stdout.includes(JSON.parse(stored.toString()).studySha256), false)
    const again = save(source, destination)
    assert.equal(again.status, 1)
    assert.equal(again.stdout, '')
    assert.equal(again.stderr.includes(destination), false)
    assert.deepEqual(await readFile(destination), stored)
  })
})

test('M3 --output removes a partially created code pin on a forced write failure [EXPECTED RED]', async () => {
  if (process.platform !== 'linux') return
  await fixture(async ({ source, destination }) => {
    // Real OS resource limit: create(O_EXCL) can succeed, while the subsequent
    // write fails with EFBIG/SIGXFSZ. A stale zero-byte pin is not valid evidence.
    const failed = spawnSync('bash', [
      '-c', 'ulimit -f 0; exec "$@"',
      'bash', process.execPath, 'scripts/m3-field-code-pin.mjs', source, SHA, '--output', destination,
    ], {
      encoding: 'utf8', timeout: 3000,
    })
    assert.equal(failed.error, undefined, String(failed.error))
    assert.notEqual(failed.status, 0, 'forced filesystem write limit must not report success')
    assert.equal(failed.stdout, '')
    assert.equal(failed.stderr.includes(PRIVATE_ID), false)
    assert.equal(failed.stderr.includes(destination), false)
    await assert.rejects(stat(destination), { code: 'ENOENT' },
      'partial private manifest must be unlinked after write failure')

    // Once the resource problem is gone, the same exclusive destination should
    // be usable again without manually deleting untrusted partial evidence.
    const retried = save(source, destination)
    assert.equal(retried.status, 0, String(retried.error || retried.stderr))
    const manifest = JSON.parse(await readFile(destination, 'utf8'))
    assert.equal(verifyPrivateM3StudyCodePin(study, manifest), true)
    assert.equal(manifest.publicSavingsClaimEligible, false)
  })
})
