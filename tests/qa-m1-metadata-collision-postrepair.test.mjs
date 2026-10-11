import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Synthetic postrepair QA for #1272. PATH resolves curl to the local fixture only.
const ID = 'dirk-halvarine'
const CLOCK = 1791676800789
const SECRET = 'PRIVATE-FAKE-BODY-NOT-SUPERMARKET-EVIDENCE'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-meta-qa-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { mode: 0o700 })
  const calls = join(root, 'curl-calls')
  const curl = join(bin, 'curl')
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
    "printf 'x\n' >> '" + calls + "'",
    "printf 'HTTP/1.1 200 Fixture\r\nContent-Type: text/html\r\n\r\n' > \"$header\"",
    "printf '<html>" + SECRET + "</html>' > \"$body\"",
    "printf '200'",
  ].join('\n'), { mode: 0o700 })
  await chmod(curl, 0o700)
  const outputDir = join(root, 'research')
  const dir = join(outputDir, ID)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const stem = 'capture-' + CLOCK + '-' + process.pid
  return {
    root, outputDir, dir,
    html: join(dir, stem + '.html'), meta: join(dir, stem + '.json'),
    calls, env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
  }
}

async function captureAtFixedStem(f) {
  const original = Date.now
  Date.now = () => CLOCK
  try {
    return await captureResearchSource(ID, { outputDir: f.outputDir, env: f.env })
  } finally {
    Date.now = original
  }
}

async function assertOneCall(f) {
  assert.deepEqual((await readFile(f.calls, 'utf8')).trim().split('\n'), ['x'])
}

test('metadata symlink collision never follows or removes target and leaves no orphan HTML', async () => {
  const f = await fixture()
  try {
    const target = join(f.root, 'protected-private-metadata.txt')
    const sentinel = 'EXISTING-PRIVATE-TARGET-UNMODIFIED'
    await writeFile(target, sentinel, { mode: 0o600 })
    await symlink(target, f.meta)
    await assert.rejects(captureAtFixedStem(f), err =>
      err instanceof Error && err.code === 'EEXIST' && !err.message.includes(SECRET))
    assert.equal((await lstat(f.meta)).isSymbolicLink(), true)
    assert.equal(await readFile(target, 'utf8'), sentinel)
    await assert.rejects(stat(f.html), { code: 'ENOENT' })
    assert.deepEqual(await readdir(f.dir), [f.meta.split('/').at(-1)])
    await assertOneCall(f)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('metadata directory collision preserves the directory and creates no HTML', async () => {
  const f = await fixture()
  try {
    await mkdir(f.meta, { mode: 0o700 })
    await assert.rejects(captureAtFixedStem(f), err =>
      err instanceof Error && err.code === 'EEXIST' && !err.message.includes(SECRET))
    assert.equal((await lstat(f.meta)).isDirectory(), true)
    await assert.rejects(stat(f.html), { code: 'ENOENT' })
    assert.deepEqual(await readdir(f.dir), [f.meta.split('/').at(-1)])
    await assertOneCall(f)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('second capture with identical stem fails without deleting valid first private pair', async () => {
  const f = await fixture()
  try {
    const saved = await captureAtFixedStem(f)
    assert.equal(saved.status, 'saved')
    const oldHtml = await readFile(f.html)
    const oldMeta = await readFile(f.meta)
    assert.match(oldHtml.toString('utf8'), /PRIVATE-FAKE-BODY/)
    assert.equal(JSON.parse(oldMeta.toString('utf8')).type, 'research-only-not-price-proof')
    assert.equal((await stat(f.html)).mode & 0o777, 0o600)
    assert.equal((await stat(f.meta)).mode & 0o777, 0o600)
    await assert.rejects(captureAtFixedStem(f), err =>
      err instanceof Error && err.code === 'EEXIST' && !err.message.includes(SECRET))
    assert.deepEqual(await readFile(f.html), oldHtml)
    assert.deepEqual(await readFile(f.meta), oldMeta)
    assert.equal((await readdir(f.dir)).length, 2)
    assert.deepEqual((await readFile(f.calls, 'utf8')).trim().split('\n'), ['x', 'x'])
  } finally { await rm(f.root, { recursive: true, force: true }) }
})


test('two concurrent fake captures sharing a stem preserve exactly one complete private pair', async () => {
  const f = await fixture()
  const original = Date.now
  Date.now = () => CLOCK
  try {
    const results = await Promise.allSettled([
      captureResearchSource(ID, { outputDir: f.outputDir, env: f.env }),
      captureResearchSource(ID, { outputDir: f.outputDir, env: f.env }),
    ])
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
    const failure = results.find(item => item.status === 'rejected')
    assert.equal(failure?.reason?.code, 'EEXIST')
    assert.doesNotMatch(failure.reason.message, /PRIVATE-FAKE-BODY/)
    assert.deepEqual((await readdir(f.dir)).sort(), [
      f.html.split('/').at(-1), f.meta.split('/').at(-1),
    ].sort())
    assert.equal((await stat(f.html)).mode & 0o777, 0o600)
    assert.equal((await stat(f.meta)).mode & 0o777, 0o600)
    const html = await readFile(f.html)
    const metadata = JSON.parse(await readFile(f.meta, 'utf8'))
    assert.equal(metadata.type, 'research-only-not-price-proof')
    assert.equal(metadata.bytes, html.length)
    assert.match(html.toString(), /PRIVATE-FAKE-BODY/)
    assert.deepEqual((await readFile(f.calls, 'utf8')).trim().split('\n'), ['x', 'x'])
  } finally {
    Date.now = original
    await rm(f.root, { recursive: true, force: true })
  }
})
