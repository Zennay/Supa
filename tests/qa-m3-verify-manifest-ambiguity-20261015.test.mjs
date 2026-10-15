import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'

// Independent verify-mode acceptance on immutable product #2837 SHA 59e07747daa5a9f0a016eff236fae40bbdaa5580.
// No real study, permission grants, supermarket data or public financial claims.
const SHA = '1234567890abcdef1234567890abcdef12345678'
const ALT_SHA = 'fedcba9876543210fedcba9876543210fedcba98'
const SENSITIVE = 'qa-fictional-private-study-only'
const studyBytes = Buffer.from(JSON.stringify({
  schemaVersion: 1, studyId: SENSITIVE,
  baseline: { observation: 'fictional-plus' },
  candidate: { observation: 'fictional-dekamarkt' },
}))
const pin = createPrivateM3StudyCodePin(studyBytes, SHA)

function verify(study, manifest) {
  return spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', '--verify', study, manifest], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 64 * 1024,
  })
}

async function withStudy(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-qa-verify-'))
  try {
    const study = join(dir, 'private-study.json')
    const manifest = join(dir, 'private-manifest.json')
    await writeFile(study, studyBytes, { mode: 0o600 })
    await callback({ dir, study, manifest })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function assertDenied(result, manifest) {
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.status, 1, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.includes(SENSITIVE), false)
  assert.equal(result.stderr.includes(manifest), false)
}

test('M3 verify mode accepts exactly bounded canonical JSON but never upgrades any permission flag', async () => {
  await withStudy(async ({ study, manifest }) => {
    const body = JSON.stringify(pin)
    await writeFile(manifest, body + ' '.repeat(4096 - Buffer.byteLength(body)), { mode: 0o600 })
    const accepted = verify(study, manifest)
    assert.equal(accepted.status, 0, String(accepted.error || accepted.stderr))
    assert.deepEqual(JSON.parse(accepted.stdout), {
      privateStudyBytesMatch: true,
      codeRevisionVerified: false,
      retailerPermissionVerified: false,
      publicSavingsClaimEligible: false,
    })
    assert.equal((accepted.stdout + accepted.stderr).includes(SENSITIVE), false)

    await writeFile(manifest, body + ' '.repeat(4097 - Buffer.byteLength(body)), { mode: 0o600 })
    assertDenied(verify(study, manifest), manifest)
  })
})

test('M3 verify mode rejects a malformed manifest suffix and invalid UTF-8', async () => {
  await withStudy(async ({ study, manifest }) => {
    for (const body of [
      Buffer.from(JSON.stringify(pin) + '\u0000'),
      Buffer.concat([Buffer.from(JSON.stringify(pin)), Buffer.from([0xff])]),
      Buffer.from(JSON.stringify(pin) + '{}'),
    ]) {
      await writeFile(manifest, body, { mode: 0o600 })
      assertDenied(verify(study, manifest), manifest)
    }
  })
})

test('M3 verify mode denies symlink or hardlink manifest aliases even for correct content', async () => {
  await withStudy(async ({ dir, study, manifest }) => {
    await writeFile(manifest, JSON.stringify(pin), { mode: 0o600 })
    const alias = join(dir, 'manifest-symlink.json')
    const hard = join(dir, 'manifest-hardlink.json')
    await symlink(manifest, alias)
    await link(manifest, hard)
    assertDenied(verify(study, alias), alias)
    assertDenied(verify(study, hard), hard)
  })
})

test('M3 verify mode must reject duplicate public claim flags even when the final JSON value is false [EXPECTED RED]', async () => {
  await withStudy(async ({ study, manifest }) => {
    const canonical = JSON.stringify(pin)
    const forged = canonical.replace(
      '"publicSavingsClaimEligible":false',
      '"publicSavingsClaimEligible":true,"publicSavingsClaimEligible":false',
    )
    assert.notEqual(forged, canonical)
    assert.equal(JSON.parse(forged).publicSavingsClaimEligible, false, 'JSON.parse last-wins demonstrates the ambiguity')
    await writeFile(manifest, forged, { mode: 0o600 })
    assertDenied(verify(study, manifest), manifest)
  })
})

test('M3 verify mode must reject conflicting duplicated source SHA even when the last SHA is correct [EXPECTED RED]', async () => {
  await withStudy(async ({ study, manifest }) => {
    const canonical = JSON.stringify(pin)
    const forged = canonical.replace(
      '"sourceCommitSha":"' + SHA + '"',
      '"sourceCommitSha":"' + ALT_SHA + '","sourceCommitSha":"' + SHA + '"',
    )
    assert.notEqual(forged, canonical)
    assert.equal(JSON.parse(forged).sourceCommitSha, SHA, 'ordinary JSON.parse silently drops the first SHA')
    await writeFile(manifest, forged, { mode: 0o600 })
    assertDenied(verify(study, manifest), manifest)
  })
})
