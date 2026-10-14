import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #723: metadata-only invalid UTF-8 path verification in an alternate Git
// index. No real filesystem artifact with these bytes is ever created, and
// no secrets, private evidence or source contents are opened.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const placeholder = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function verifyRawGitPath(pathBytes) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa-723-invalid-utf8-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const initial = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(initial.status, 0, initial.stderr?.toString())
    const input = Buffer.concat([
      Buffer.from('100644 ' + placeholder + ' 0\\t'.replace('\\t', '\t')),
      pathBytes,
      Buffer.from([0]),
    ])
    const staged = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input,
    })
    assert.equal(staged.status, 0, 'could not construct test index: ' + staged.stderr?.toString())
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, env })
    assert.ok(index.includes(Buffer.concat([Buffer.from('\t'), pathBytes, Buffer.from([0])])),
      'test case must be represented by exact raw filename bytes in Git index')
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return { accepted: result.status === 0, logs: result.stdout + result.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const [name, path] of [
  ['stray 0xff continuation', Buffer.from([...'docs/'.split('').map(x => x.charCodeAt(0)), 0xff, 0x2e, 0x6d, 0x64])],
  ['truncated two-byte character', Buffer.concat([Buffer.from('docs/invalid-'), Buffer.from([0xc3]), Buffer.from('.txt')])],
  ['overlong UTF-8 slash bytes', Buffer.concat([Buffer.from('docs/unsafe-'), Buffer.from([0xc0, 0xaf]), Buffer.from('.md')])],
]) {
  test('QA #723 expected RED: tracked path must reject ' + name, () => {
    const result = verifyRawGitPath(path)
    assert.equal(result.accepted, false, 'invalid UTF-8 bytes may not appear in portable checked-out index: ' + name + '\n' + result.logs)
    assert.match(result.logs, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #723 normal valid UTF-8 source names remain allowed', () => {
  for (const path of ['docs/boodschappen-é.md', 'docs/Überzicht.txt', 'docs/食材.md']) {
    const result = verifyRawGitPath(Buffer.from(path, 'utf8'))
    assert.equal(result.accepted, true, 'valid multilingual Unicode path rejected: ' + path + '\n' + result.logs)
  }
})
