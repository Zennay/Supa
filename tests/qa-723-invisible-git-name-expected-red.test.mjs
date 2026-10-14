import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// QA #723: source-free test of visually invisible Git path components.
// Never create secret files: all staged paths reuse public HEAD:.gitignore
// through an isolated ephemeral GIT_INDEX_FILE, and only index bytes are read.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const blob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function validate(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-hidden-git-name-red-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    const data = Buffer.concat(paths.map((path) => Buffer.concat([
      Buffer.from('100644 ' + blob + ' 0\t'), Buffer.from(path), Buffer.from([0]),
    ])))
    const staging = spawnSync('git', ['update-index', '-z', '--index-info'], {
      cwd: root, env, input: data,
    })
    assert.equal(staging.status, 0, staging.stderr?.toString())
    const staged = execFileSync('git', ['ls-files', '-z'], { cwd: root, env })
    for (const path of paths) {
      assert.ok(staged.includes(Buffer.concat([Buffer.from(path), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, null)
    return { status: result.status, output: (result.stdout || '') + (result.stderr || '') }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const [name, path] of [
  ['zero-width space in env label', 'src/.en\u200bv.local'],
  ['word joiner in env label', 'src/.en\u2060v.production'],
  ['soft hyphen in env label', 'src/.en\u00adv'],
  ['BOM in env label', 'src/.en\ufeffv'],
  ['combining grapheme joiner in env label', 'src/.en\u034fv'],
  ['zero-width space in ordinary file label', 'docs/check\u200b-list.md'],
]) {
  test('QA #723: reject hidden tracked filename ' + name, () => {
    const result = validate([path])
    assert.notEqual(result.status, 0, 'hidden path accepted\n' + result.output)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #723: safe visible and language joiner filenames remain allowed', () => {
  const result = validate([
    '.env.example',
    'docs/maaltijdplan.md',
    'docs/cafe\u0301.md',
    'docs/👩‍🍳-planning.md',
    'docs/می\u200cروم.md',
    'src/prijsberekening.ts',
  ])
  assert.equal(result.status, 0, 'benign filename falsely rejected\n' + result.output)
})
