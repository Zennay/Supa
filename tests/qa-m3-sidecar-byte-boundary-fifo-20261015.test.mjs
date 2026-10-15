import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPrivateM3StudyCodePin,
  verifyPrivateM3StudyCodePin,
} from '../scripts/m3-field-code-pin.mjs'

// Independent acceptance against frozen product #2837, SHA 686e9a9181d86ca4a24585a4a1aaacaef76d0ef4.
// All identifiers are fictional; the tests never contact retailers or create genuine field evidence.
const SHA = 'abcdef0123456789abcdef0123456789abcdef01'
const LIMIT = 4 * 1024 * 1024
const SECRET = 'qa-fictional-private-protected-id'
const fixture = Buffer.from(JSON.stringify({
  schemaVersion: 1,
  studyId: SECRET,
  baseline: { source: 'qa-fictional-plus-only' },
  candidate: { source: 'qa-fictional-deka-only' },
}), 'utf8')

function invoke(path, sha = SHA) {
  return spawnSync(process.execPath, ['scripts/m3-field-code-pin.mjs', path, sha], {
    encoding: 'utf8',
    timeout: 2500,
    maxBuffer: 128 * 1024,
  })
}

test('M3 sidecar independently binds a legal exact 4 MiB UTF-8 input, but denies 4 MiB + 1', () => {
  const atLimit = Buffer.concat([fixture, Buffer.alloc(LIMIT - fixture.length, 0x20)])
  const pin = createPrivateM3StudyCodePin(atLimit, SHA)
  assert.equal(pin.studySha256, createHash('sha256').update(atLimit).digest('hex'))
  assert.equal(verifyPrivateM3StudyCodePin(atLimit, pin), true)
  assert.equal(verifyPrivateM3StudyCodePin(fixture, pin), false)
  assert.throws(
    () => createPrivateM3StudyCodePin(Buffer.concat([atLimit, Buffer.from(' ')]), SHA),
    /Invalid private M3 study code-pin input/,
  )
  assert.equal(pin.codeRevisionVerified, false)
  assert.equal(pin.retailerPermissionVerified, false)
  assert.equal(pin.publicSavingsClaimEligible, false)
})

test('M3 sidecar fails closed for invalid UTF-8 even if JSON prefix is structurally plausible', () => {
  for (const malformed of [
    Buffer.concat([fixture, Buffer.from([0xc3, 0x28])]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture, Buffer.from([0xff])]),
    Buffer.concat([fixture, Buffer.from([0x00])]),
  ]) {
    assert.throws(
      () => createPrivateM3StudyCodePin(malformed, SHA),
      /Invalid private M3 study code-pin input/,
    )
  }
})

test('M3 sidecar hashes Unicode text byte-exactly and prints no private fields', async () => {
  const text = JSON.stringify({
    schemaVersion: 1, studyId: SECRET,
    baseline: { description: 'fictief: naïef café 🍊' },
    candidate: { description: 'fictief: thee 🍋' },
  })
  const bytes = Buffer.from(text, 'utf8')
  const pin = createPrivateM3StudyCodePin(bytes, SHA)
  assert.equal(pin.studySha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(verifyPrivateM3StudyCodePin(bytes, pin), true)
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-sidecar-unicode-'))
  try {
    const path = join(dir, 'private.json')
    await writeFile(path, bytes, { mode: 0o600 })
    const cli = invoke(path)
    assert.equal(cli.status, 0, String(cli.error || cli.stderr))
    assert.deepEqual(JSON.parse(cli.stdout), pin)
    for (const forbidden of [SECRET, 'café', '🍊', 'thee', '🍋', path]) {
      assert.equal((cli.stdout + cli.stderr).includes(forbidden), false)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 sidecar CLI rejects missing file and directory with generic private-safe error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-sidecar-invalid-'))
  try {
    await mkdir(join(dir, 'folder'))
    for (const path of [join(dir, 'missing-' + SECRET + '.json'), join(dir, 'folder')]) {
      const run = invoke(path)
      assert.equal(run.status, 1, String(run.error || run.stderr))
      assert.equal(run.stdout, '')
      assert.equal(run.stderr.includes(path), false)
      assert.equal(run.stderr.includes(SECRET), false)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 sidecar CLI refuses a named pipe promptly instead of hanging at open() [security acceptance]', async () => {
  if (process.platform !== 'linux') return
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-sidecar-fifo-'))
  try {
    const path = join(dir, 'private-' + SECRET + '.fifo')
    const mk = spawnSync('mkfifo', [path], { encoding: 'utf8' })
    assert.equal(mk.status, 0, mk.stderr)
    const result = invoke(path)
    // A FIFO has no file size and no writer. Opening it without O_NONBLOCK
    // blocks forever BEFORE the current fstat/isFile refusal can run.
    assert.equal(result.error, undefined, 'CLI hung on FIFO rather than refusing before blocking')
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr.includes(path), false)
    assert.equal(result.stderr.includes(SECRET), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
