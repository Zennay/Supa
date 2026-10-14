import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent QA acceptance for #1794. All paths live only in a disposable
// alternate Git index and all records point to the public .gitignore blob.
// Never open tracked file data, real project secrets or private evidence.
const root = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const publicBlob = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], {
  cwd: root, encoding: 'utf8',
}).trim()

function probe(paths) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-bidi-accept-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const seed = spawnSync('git', ['read-tree', 'HEAD'], { cwd: root, env })
    assert.equal(seed.status, 0, seed.stderr?.toString())
    for (const path of paths) {
      const stage = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd: root, env,
        input: Buffer.concat([
          Buffer.from('100644 ' + publicBlob + ' 0\t'),
          Buffer.from(path),
          Buffer.from([0]),
        ]),
      })
      assert.equal(stage.status, 0, stage.stderr?.toString())
    }
    const entries = execFileSync('git', ['ls-files', '-z'], { cwd: root, env })
    for (const path of paths) {
      assert.ok(entries.includes(Buffer.concat([Buffer.from(path), Buffer.from([0])])))
    }
    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', guard], {
      cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    })
    assert.ifError(result.error)
    return { ok: result.status === 0, output: (result.stdout || '') + (result.stderr || '') }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

for (const [name, path] of [
  ['right-to-left embedding', 'docs/what\u202bgoes.md'],
  ['left-to-right embedding', 'src/notes\u202aplan.ts'],
  ['pop directional formatting', 'docs/notes\u202cafter.md'],
  ['first strong isolate', 'docs/prices\u2068note.md'],
  ['pop directional isolate', 'src/label\u2069test.ts'],
  ['right-to-left mark', 'docs/a\u200fb.md'],
]) {
  test('QA #1794 independent: reject ' + name + ' in an indexed filename', () => {
    const result = probe([path])
    assert.equal(result.ok, false, 'bidi control bypass: ' + name + '\n' + result.output)
    assert.match(result.output, /tracked checkout violates reviewed hygiene contract/)
  })
}

test('QA #1794 independent: preserve ordinary mixed-language paths and benign Unicode', () => {
  const ok = probe([
    'docs/מוצרים.md',
    'docs/الوصفات.md',
    'docs/prijs-per-100g.md',
    'src/SUPA-Recepten.ts',
    'docs/één-week.md',
    'docs/👩‍🍳-maaltijden.md',
    'docs/readme_copy.md',
  ])
  assert.equal(ok.ok, true, 'ordinary path rejected\n' + ok.output)
})
