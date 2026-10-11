import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// #723 independent postrepair QA. Alter only a short-lived alternate Git
// index. Never create files named by the synthetic raw path bytes or inspect
// any ignored/secret/retailer evidence files.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const hygiene = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const placeholder = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], { cwd, encoding: 'utf8' }).trim()

function accepted(rawPath) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa-723-utf8-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const before = spawnSync('git', ['read-tree', 'HEAD'], { cwd, env })
    assert.equal(before.status, 0, before.stderr?.toString())
    const bytes = Buffer.concat([
      Buffer.from('100644 ' + placeholder + ' 0\t'),
      rawPath,
      Buffer.from([0]),
    ])
    const add = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd, env, input: bytes,
    })
    assert.equal(add.status, 0, 'synthetic test index must stage raw bytes: ' + add.stderr?.toString())
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd, env })
    assert.ok(index.includes(Buffer.concat([Buffer.from('\t'), rawPath, Buffer.from([0])])),
      'assert that the exact synthetic filename bytes are actually in the index')
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', hygiene], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.ifError(child.error)
    assert.notEqual(child.status, null)
    return { ok: child.status === 0, logs: child.stdout + child.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('QA #723 reject independently sampled invalid UTF-8 path encodings', () => {
  const cases = [
    ['isolated continuation', Buffer.concat([Buffer.from('notes/lone-'), Buffer.from([0x80]), Buffer.from('.md')])],
    ['UTF-8 encoded surrogate', Buffer.concat([Buffer.from('notes/surrogate-'), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('.md')])],
    ['code point beyond Unicode maximum', Buffer.concat([Buffer.from('notes/too-high-'), Buffer.from([0xf4, 0x90, 0x80, 0x80]), Buffer.from('.md')])],
  ]
  for (const [label, path] of cases) {
    const result = accepted(path)
    assert.equal(result.ok, false, 'nonportable path accepted: ' + label + '\n' + result.logs)
    assert.match(result.logs, /tracked checkout violates reviewed hygiene contract: invalid UTF-8/)
  }
})

test('QA #723 legitimate Unicode filenames remain portable', () => {
  for (const path of [
    'docs/Crème-brûlée.md',
    'docs/日本語.md',
    'docs/boodschappen-🍚.md',
  ]) {
    const result = accepted(Buffer.from(path, 'utf8'))
    assert.equal(result.ok, true, 'legal Unicode filename rejected: ' + path + '\n' + result.logs)
  }
})
