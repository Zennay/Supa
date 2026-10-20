import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, symlink, link, stat, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createPrivateM3StudyCodePin,
  verifyPrivateM3StudyCodePin,
  parseStrictPrivateM3Manifest,
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

test('M3 --output creates private exclusive sidecar and never overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-output-'))
  try {
    const source = join(dir, 'study.json')
    const target = join(dir, 'code-pin.json')
    await writeFile(source, bytes, { mode: 0o600 })
    const args = ['scripts/m3-field-code-pin.mjs', source, SHA, '--output', target]
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.stdout.includes('synthetic-plus'), false)
    assert.equal((await stat(target)).mode & 0o777, 0o600)
    const original = await readFile(target)
    assert.equal(verifyPrivateM3StudyCodePin(bytes, JSON.parse(original.toString())), true)
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.equal(second.status, 1)
    assert.equal(second.stdout, '')
    assert.deepEqual(await readFile(target), original)
    assert.equal(second.stderr.includes(target), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 --output refuses symlinked parent and Git tree marker without writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-paths-'))
  try {
    const source = join(dir, 'study.json')
    await writeFile(source, bytes, { mode: 0o600 })
    await mkdir(join(dir, 'clean'))
    await symlink(join(dir, 'clean'), join(dir, 'alias'))
    await mkdir(join(dir, 'checkout'))
    await writeFile(join(dir, 'checkout', '.git'), 'gitdir: /private/elsewhere')
    for (const target of [join(dir, 'alias', 'pin.json'), join(dir, 'checkout', 'pin.json')]) {
      const outcome = spawnSync(process.execPath,
        ['scripts/m3-field-code-pin.mjs', source, SHA, '--output', target], { encoding: 'utf8' })
      assert.equal(outcome.status, 1)
      assert.equal(outcome.stdout, '')
      assert.equal(outcome.stderr.includes(target), false)
    }
    await assert.rejects(stat(join(dir, 'clean', 'pin.json')))
    await assert.rejects(stat(join(dir, 'checkout', 'pin.json')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 strict sidecar parser rejects duplicate source revisions and forged flags before JSON last-wins', () => {
  const valid = createPrivateM3StudyCodePin(bytes, SHA)
  const manifest = JSON.stringify(valid)
  assert.deepEqual(parseStrictPrivateM3Manifest(manifest), valid)
  const conflictingSha = manifest.replace(
    '"sourceCommitSha":',
    '"sourceCommitSha":"' + 'f'.repeat(40) + '","sourceCommitSha":',
  )
  const conflictingFlag = manifest.replace(
    '"publicSavingsClaimEligible":false',
    '"publicSavingsClaimEligible":true,"publicSavingsClaimEligible":false',
  )
  const escapedName = manifest.replace(
    '"sourceCommitSha":',
    '"source\\\\u0043ommitSha":"' + 'f'.repeat(40) + '","sourceCommitSha":',
  )
  for (const candidate of [conflictingSha, conflictingFlag, escapedName]) {
    assert.throws(() => parseStrictPrivateM3Manifest(candidate), /Invalid private M3/)
  }
})

test('M3 strict sidecar parser permits benign whitespace but rejects nested, trailing and missing fields', () => {
  const valid = createPrivateM3StudyCodePin(bytes, SHA)
  assert.deepEqual(parseStrictPrivateM3Manifest('  ' + String.fromCharCode(10) + JSON.stringify(valid) + String.fromCharCode(9) + '  '), valid)
  for (const value of [
    JSON.stringify(valid) + 'not-json',
    JSON.stringify({ ...valid, unexpected: 'extra' }),
    JSON.stringify({ ...valid, sourceCommitSha: undefined }),
    JSON.stringify({ ...valid, studySha256: { nested: 'bad' } }),
    JSON.stringify({ ...valid, codeRevisionVerified: 0 }),
    '{"format":}',
    '{"format":"x",}',
  ]) {
    assert.throws(() => parseStrictPrivateM3Manifest(value), /Invalid private M3/)
  }
})

test('M3 --verify CLI refuses contradictory duplicate source or release-attestation keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-duplicates-'))
  try {
    const study = join(dir, 'study.json')
    const manifest = join(dir, 'manifest.json')
    await writeFile(study, bytes, { mode: 0o600 })
    const original = JSON.stringify(createPrivateM3StudyCodePin(bytes, SHA))
    const hostile = [
      original.replace('"sourceCommitSha":', '"sourceCommitSha":"' + 'f'.repeat(40) + '","sourceCommitSha":'),
      original.replace('"publicSavingsClaimEligible":false', '"publicSavingsClaimEligible":true,"publicSavingsClaimEligible":false'),
    ]
    for (const input of hostile) {
      await writeFile(manifest, input, { mode: 0o600 })
      const run = spawnSync(process.execPath,
        ['scripts/m3-field-code-pin.mjs', '--verify', study, manifest],
        { encoding: 'utf8', timeout: 2500 })
      assert.equal(run.status, 1, String(run.error ?? ''))
      assert.equal(run.stdout, '')
      assert.equal(run.stderr.includes(study), false)
      assert.equal(run.stderr.includes(manifest), false)
      assert.equal(run.stderr.includes('synthetic-plus'), false)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 code-pin CLI declines FIFO source and --verify FIFO manifest without blocking', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux mkfifo acceptance')
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-fifo-'))
  try {
    const fifo = join(dir, 'unsafe-pipe')
    const make = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    assert.equal(make.status, 0, make.stderr)
    const study = join(dir, 'study.json')
    await writeFile(study, bytes, { mode: 0o600 })
    for (const args of [
      [fifo, SHA],
      ['--verify', study, fifo],
    ]) {
      const run = spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', ...args],
        { encoding: 'utf8', timeout: 2500 })
      assert.equal(run.error, undefined, String(run.error))
      assert.equal(run.status, 1, run.stderr)
      assert.equal(run.stdout, '')
      assert.equal(run.stderr.includes(fifo), false)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 exclusive private output does not publish a partial target on real Linux file-limit failure', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux ulimit -f required')
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-pin-atomic-'))
  try {
    const input = join(dir, 'study.json')
    const output = join(dir, 'sidecar.json')
    await writeFile(input, bytes, { mode: 0o600 })
    const limited = spawnSync('bash', ['-c',
      'ulimit -f 0; exec node scripts/m3-field-code-pin.mjs "$1" "$2" --output "$3"',
      'm3-codepin', input, SHA, output,
    ], { encoding: 'utf8', timeout: 2500 })
    assert.notEqual(limited.status, 0)
    assert.equal(limited.stdout, '')
    assert.equal(limited.stderr.includes(input), false)
    assert.equal(limited.stderr.includes(output), false)
    await assert.rejects(stat(output), { code: 'ENOENT' })
    // A retry after the forced write failure must not be blocked by a
    // zero-byte/truncated output or by a failed staging artefact.
    const retried = spawnSync(process.execPath,
      ['scripts/m3-field-code-pin.mjs', input, SHA, '--output', output],
      { encoding: 'utf8', timeout: 2500 })
    assert.equal(retried.status, 0, retried.stderr)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(verifyPrivateM3StudyCodePin(bytes,
      JSON.parse(await readFile(output, 'utf8'))), true)
    // An abruptly killed process can leave an inaccessible-to-others 0700
    // staging directory, but it must never publish an incomplete final name.
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
