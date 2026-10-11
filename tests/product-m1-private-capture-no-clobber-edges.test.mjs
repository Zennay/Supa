import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Extra independent synthetic acceptance for #1272 on immutable repaired writer.
const CLOCK = 1791676800456
const ID = 'dirk-halvarine'
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-no-clobber-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { mode: 0o700 })
  const curl = join(bin, 'curl')
  const calls = join(root, 'curl-invocations')
  await writeFile(curl, [
    '#!/bin/sh',
    'header=""',
    'body=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --dump-header) header="$2"; shift 2 ;;',
    '    --output) body="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    "printf 'x\\n' >> '" + calls + "'",
    "printf 'HTTP/1.1 200 Fixture\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$header\"",
    "printf '<html>fake only</html>' > \"$body\"",
    "printf '200'",
  ].join('\n'), { mode: 0o700 })
  await chmod(curl, 0o700)
  const outputDir = join(root, 'private')
  const privateDir = join(outputDir, ID)
  await mkdir(privateDir, { recursive: true, mode: 0o700 })
  const base = 'capture-' + CLOCK + '-' + process.pid
  return {
    root, calls, outputDir, html: join(privateDir, base + '.html'),
    meta: join(privateDir, base + '.json'), privateDir,
    env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
  }
}

async function runAtFixedStem(f) {
  const original = Date.now
  Date.now = () => CLOCK
  try {
    return await captureResearchSource(ID, { outputDir: f.outputDir, env: f.env })
  } finally {
    Date.now = original
  }
}

test('pre-existing private HTML collision cannot be overwritten or paired with new metadata', async () => {
  const f = await fixture()
  try {
    const original = 'EXISTING-HTML-REMAINS-UNCHANGED'
    await writeFile(f.html, original, { mode: 0o600 })
    await assert.rejects(runAtFixedStem(f), /EEXIST/)
    assert.equal(await readFile(f.html, 'utf8'), original)
    await assert.rejects(stat(f.meta), { code: 'ENOENT' })
    assert.deepEqual(await readdir(f.privateDir), [f.html.split('/').at(-1)])
    assert.equal((await readFile(f.calls, 'utf8')).trim(), 'x')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('a pre-existing private HTML symlink cannot be followed, clobbered or deleted', async () => {
  const f = await fixture()
  try {
    const target = join(f.root, 'protected.txt')
    await writeFile(target, 'LOCAL-PROTECTED-PAYLOAD', { mode: 0o600 })
    await symlink(target, f.html)
    await assert.rejects(runAtFixedStem(f), /EEXIST/)
    assert.equal(await readFile(target, 'utf8'), 'LOCAL-PROTECTED-PAYLOAD')
    assert.equal((await stat(f.html)).isFile(), true) // stat may follow the symlink, but contents are untouched.
    await assert.rejects(stat(f.meta), { code: 'ENOENT' })
    assert.equal((await readFile(f.calls, 'utf8')).trim(), 'x')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
