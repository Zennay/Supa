import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// #1272 synthetic failure injection only: a local fake curl never contacts retailers.
const SOURCE = 'dirk-halvarine'
const FIXED_NOW = 1791676800123
const HTML_SECRET = 'SYNTHETIC-PRIVATE-RESEARCH-BODY-NOT-EVIDENCE'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'supa-pair-transaction-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { mode: 0o700 })
  const calls = join(root, 'curl-calls')
  const script = [
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
    "printf 'HTTP/1.1 200 Synthetic\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$header\"",
    "printf '<html>" + HTML_SECRET + "</html>' > \"$body\"",
    "printf '200'",
    '',
  ].join('\n')
  const curl = join(bin, 'curl')
  await writeFile(curl, script, { mode: 0o700 })
  await chmod(curl, 0o700)
  const outputDir = join(root, 'private-research')
  const dir = join(outputDir, SOURCE)
  const basename = 'capture-' + FIXED_NOW + '-' + process.pid
  const html = join(dir, basename + '.html')
  const meta = join(dir, basename + '.json')
  const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
  return { root, calls, outputDir, dir, html, meta, env }
}

async function withFixedStem(fn) {
  const originalNow = Date.now
  Date.now = () => FIXED_NOW
  try { return await fn() } finally { Date.now = originalNow }
}

test('metadata collision must not strand new orphan HTML or overwrite existing private metadata', async () => {
  const f = await fixture()
  const sentinel = 'PREEXISTING-PRIVATE-METADATA-UNCHANGED'
  try {
    await mkdir(f.dir, { recursive: true, mode: 0o700 })
    await writeFile(f.meta, sentinel, { mode: 0o600 })
    await withFixedStem(async () => {
      await assert.rejects(
        captureResearchSource(SOURCE, { outputDir: f.outputDir, env: f.env }),
        error => error instanceof Error && /EEXIST/.test(error.message) &&
          !error.message.includes(HTML_SECRET),
      )
    })
    assert.equal(await readFile(f.meta, 'utf8'), sentinel)
    await assert.rejects(stat(f.html), { code: 'ENOENT' })
    assert.deepEqual(await readdir(f.dir), ['capture-' + FIXED_NOW + '-' + process.pid + '.json'])
    assert.equal((await readFile(f.calls, 'utf8')).trim(), 'x', 'must not retry or change egress')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('normal local fake HTTP200 persists complete private non-price-evidence pair', async () => {
  const f = await fixture()
  try {
    const result = await withFixedStem(() => captureResearchSource(SOURCE, {
      outputDir: f.outputDir,
      env: f.env,
    }))
    assert.equal(result.status, 'saved')
    assert.equal(result.html, f.html)
    assert.equal(result.meta, f.meta)
    assert.equal((await stat(f.outputDir)).mode & 0o777, 0o700)
    assert.equal((await stat(f.dir)).mode & 0o777, 0o700)
    assert.equal((await stat(f.html)).mode & 0o777, 0o600)
    assert.equal((await stat(f.meta)).mode & 0o777, 0o600)
    const meta = JSON.parse(await readFile(f.meta, 'utf8'))
    assert.equal(meta.type, 'research-only-not-price-proof')
    assert.equal(meta.sourceId, SOURCE)
    assert.equal(meta.httpStatus, 200)
    assert.equal(meta.proxyMode, 'direct')
    assert.match(await readFile(f.html, 'utf8'), /SYNTHETIC-PRIVATE-RESEARCH-BODY/)
    assert.equal((await readFile(f.calls, 'utf8')).trim(), 'x')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
