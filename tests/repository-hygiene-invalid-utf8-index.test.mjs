import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Synthetic alternate-index only: no actual nonportable filename is written.
const cwd = fileURLToPath(new URL('../', import.meta.url))
const guard = fileURLToPath(new URL('./repository-hygiene-contract.test.mjs', import.meta.url))
const placeholder = execFileSync('git', ['rev-parse', 'HEAD:.gitignore'], { cwd, encoding: 'utf8' }).trim()

function scanIndexPath(rawName) {
  const scratch = mkdtempSync(join(tmpdir(), 'supa-qa723-'))
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }
    const base = spawnSync('git', ['read-tree', 'HEAD'], { cwd, env, encoding: 'utf8' })
    assert.equal(base.status, 0, base.stderr)
    const input = Buffer.concat([
      Buffer.from(`100644 ${placeholder}\t`), rawName, Buffer.from('\n'),
    ])
    const staged = spawnSync('git', ['update-index', '--index-info'], {
      cwd, env, input, encoding: 'utf8',
    })
    assert.equal(staged.status, 0, staged.stderr)
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd, env })
    assert.ok(index.includes(Buffer.concat([Buffer.from('\t'), rawName, Buffer.from([0])])))

    const childEnv = { ...env }
    delete childEnv.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--test', guard], {
      cwd, env: childEnv, encoding: 'utf8', maxBuffer: 1024 * 1024,
    })
    assert.equal(child.error, undefined)
    return { ok: child.status === 0, output: child.stdout + child.stderr }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test('QA #723: undecodable byte and truncated UTF-8 index names fail closed', () => {
  for (const rawName of [
    Buffer.concat([Buffer.from('docs/bad-'), Buffer.from([0xff]), Buffer.from('.md')]),
    Buffer.concat([Buffer.from('docs/truncated-'), Buffer.from([0xc3]), Buffer.from('.md')]),
  ]) {
    const result = scanIndexPath(rawName)
    assert.equal(result.ok, false, 'undecodable path accepted by hygiene guard')
    assert.match(result.output, /invalid UTF-8 path bytes/)
  }
})

test('QA #723: valid non-ASCII UTF-8 and literal replacement glyph remain portable', () => {
  for (const name of ['docs/café.md', 'docs/日本語.md', 'docs/replacement-�.md']) {
    const result = scanIndexPath(Buffer.from(name, 'utf8'))
    assert.equal(result.ok, true, `${name}: ${result.output.slice(-800)}`)
  }
})
