import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createPrivateM3StudyCodePin,
  verifyPrivateM3StudyCodePin,
} from '../scripts/m3-field-code-pin.mjs'

const SHA = '1234567890abcdef1234567890abcdef12345678'
const bytes = Buffer.from(JSON.stringify({
  schemaVersion: 1, studyId: 'synthetic-private-only',
  baseline: { evidenceId: 'synthetic-plus' },
  candidate: { evidenceId: 'synthetic-deka' },
}))

test('M3 private code pin binds exact input bytes to operator-supplied main SHA', () => {
  const m = createPrivateM3StudyCodePin(bytes, SHA)
  assert.equal(m.sourceCommitSha, SHA)
  assert.equal(m.studySha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(m.format, 'supa-m3-private-study-code-pin-v1')
  assert.equal(m.codeRevisionVerified, false)
  assert.equal(m.retailerPermissionVerified, false)
  assert.equal(m.publicSavingsClaimEligible, false)
  assert.equal(verifyPrivateM3StudyCodePin(bytes, m), true)
  assert.equal(Object.isFrozen(m), true)
})

test('M3 private pin refuses missing, uppercase, whitespace, placeholder and short SHAs', () => {
  for (const value of [null, undefined, 1, '', '0'.repeat(40), SHA.toUpperCase(), SHA + ' ', SHA.slice(1), 'a'.repeat(41)]) {
    assert.throws(() => createPrivateM3StudyCodePin(bytes, value), /Invalid private M3/)
  }
})

test('M3 private pin refuses malformed, non-JSON, oversize and unrelated JSON bytes', () => {
  for (const value of ['', 'not json', '{"schemaVersion":1}', '{"schemaVersion":2,"studyId":"x","baseline":{},"candidate":{}}', Buffer.alloc(4 * 1024 * 1024 + 1)]) {
    assert.throws(() => createPrivateM3StudyCodePin(value, SHA), /Invalid private M3/)
  }
})

test('M3 private pin detects changed observations without exposing original evidence', () => {
  const m = createPrivateM3StudyCodePin(bytes, SHA)
  const changed = Buffer.from(bytes.toString().replace('synthetic-plus', 'synthetic-other'))
  assert.equal(verifyPrivateM3StudyCodePin(changed, m), false)
  assert.equal(verifyPrivateM3StudyCodePin(Buffer.concat([bytes, Buffer.from(' ')]), m), false)
  assert.equal(JSON.stringify(m).includes('synthetic-private-only'), false)
  assert.equal(JSON.stringify(m).includes('synthetic-plus'), false)
})

test('M3 private pin refuses forged money eligibility and unexpected manifest fields', () => {
  const m = createPrivateM3StudyCodePin(bytes, SHA)
  for (const changed of [
    { ...m, publicSavingsClaimEligible: true },
    { ...m, retailerPermissionVerified: true },
    { ...m, codeRevisionVerified: true },
    { ...m, unexpected: 1 },
    { ...m, studySha256: 'f'.repeat(64) },
    { ...m, sourceCommitSha: '0'.repeat(40) },
  ]) {
    assert.equal(verifyPrivateM3StudyCodePin(bytes, changed), false)
  }
  assert.equal(verifyPrivateM3StudyCodePin(bytes, null), false)
})

test('M3 code-pin CLI prints only safe digest/flags and refuses invalid SHA without source disclosure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-'))
  try {
    const path = join(dir, 'private-study.json')
    await writeFile(path, bytes, { mode: 0o600 })
    const good = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', path, SHA], { encoding: 'utf8' })
    assert.equal(good.status, 0, good.stderr)
    const manifest = JSON.parse(good.stdout)
    assert.equal(verifyPrivateM3StudyCodePin(bytes, manifest), true)
    assert.equal(good.stdout.includes('synthetic-plus'), false)
    const bad = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', path, 'invalid-sha'], { encoding: 'utf8' })
    assert.equal(bad.status, 1)
    assert.equal(bad.stderr.includes(path), false)
    assert.equal(bad.stderr.includes('synthetic-plus'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 code-pin CLI denies symlink and hardlink aliases of private input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-alias-'))
  try {
    const original = join(dir, 'private.json')
    await writeFile(original, bytes, { mode: 0o600 })
    const alias = join(dir, 'private-alias.json')
    await symlink(original, alias)
    const linkPath = join(dir, 'private-hardlink.json')
    await link(original, linkPath)
    for (const path of [alias, linkPath]) {
      const run = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', path, SHA], { encoding: 'utf8' })
      assert.equal(run.status, 1)
      assert.equal(run.stderr.includes(path), false)
      assert.equal(run.stdout, '')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 pin verification refuses inherited, accessor and hidden manifest fields', () => {
  const valid = createPrivateM3StudyCodePin(bytes, SHA)
  const hidden = { ...valid }
  Object.defineProperty(hidden, 'invisible', { value: 'hidden', enumerable: false })
  assert.equal(verifyPrivateM3StudyCodePin(bytes, hidden), false)
  const symbol = { ...valid, [Symbol('secret')]: true }
  assert.equal(verifyPrivateM3StudyCodePin(bytes, symbol), false)
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'publicSavingsClaimEligible', { enumerable: true, get: () => false })
  assert.equal(verifyPrivateM3StudyCodePin(bytes, accessor), false)
  assert.equal(verifyPrivateM3StudyCodePin(bytes, Object.create(valid)), false)
  const nullPrototype = Object.assign(Object.create(null), valid)
  assert.equal(verifyPrivateM3StudyCodePin(bytes, nullPrototype), false)
})

test('M3 verify CLI confirms exact private byte digest and refuses modified originals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-verify-'))
  try {
    const study = join(dir, 'study.json')
    const manifest = join(dir, 'manifest.json')
    await writeFile(study, bytes, { mode: 0o600 })
    await writeFile(manifest, JSON.stringify(createPrivateM3StudyCodePin(bytes, SHA)), { mode: 0o600 })
    const matched = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', '--verify', study, manifest], { encoding: 'utf8' })
    assert.equal(matched.status, 0, matched.stderr)
    const result = JSON.parse(matched.stdout)
    assert.deepEqual(result, {
      privateStudyBytesMatch: true,
      codeRevisionVerified: false,
      retailerPermissionVerified: false,
      publicSavingsClaimEligible: false,
    })
    await writeFile(study, Buffer.concat([bytes, Buffer.from(' ')]))
    const changed = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', '--verify', study, manifest], { encoding: 'utf8' })
    assert.equal(changed.status, 1)
    assert.equal(changed.stdout, '')
    assert.equal(changed.stderr.includes(study), false)
    assert.equal(changed.stderr.includes('synthetic-plus'), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 verify CLI rejects forged manifest permission and savings flags', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-flags-'))
  try {
    const study = join(dir, 'study.json')
    const manifest = join(dir, 'manifest.json')
    await writeFile(study, bytes, { mode: 0o600 })
    await writeFile(manifest, JSON.stringify({ ...createPrivateM3StudyCodePin(bytes, SHA), publicSavingsClaimEligible: true }), { mode: 0o600 })
    const run = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', '--verify', study, manifest], { encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.equal(run.stdout, '')
    assert.equal(run.stderr.includes(manifest), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
