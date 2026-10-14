import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Separate from original HTML/store symlink contract; keep original test blob
// unchanged when replayed against the independent future source-owner fix.
const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const html = '<!doctype html><html><body>only-fictional-local-data</body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const source = 'synthetic-source'
const store = 'synthetic-shop'

async function prepare(mode) {
  const outer = await mkdtemp(join(tmpdir(), 'supa-m5-manifest-alias-'))
  const original = join(outer, 'original')
  const requested = join(outer, 'requested')
  const externalManifest = join(outer, 'external.json')
  await mkdir(join(original, store), { recursive: true })
  await writeFile(join(original, store, source + '.html'), html)
  const data = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: source, supermarket: store, kind: 'product', success: true,
      requestedUrl: 'https://example.invalid/synthetic',
      capturedAt: '2026-10-13T00:00:00.000Z',
      sha256: sha,
    }],
  })
  await writeFile(join(original, 'manifest.json'), data)
  if (mode === 'root-symlink') {
    await symlink(original, requested, 'dir')
  } else {
    await mkdir(join(requested, store), { recursive: true })
    await writeFile(join(requested, store, source + '.html'), html)
    await writeFile(externalManifest, data)
    if (mode === 'manifest-symlink') {
      await symlink(externalManifest, join(requested, 'manifest.json'), 'file')
    } else {
      await writeFile(join(requested, 'manifest.json'), data)
    }
  }
  return { outer, original, requested, externalManifest, mode, data }
}

function run(dir) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, dir], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  return result
}

async function unchanged(f) {
  assert.equal(await readFile(join(f.original, 'manifest.json'), 'utf8'), f.data)
  assert.equal(await readFile(join(f.original, store, source + '.html'), 'utf8'), html)
  if (f.mode === 'manifest-symlink') {
    assert.equal((await lstat(join(f.requested, 'manifest.json'))).isSymbolicLink(), true)
    assert.equal(await readFile(f.externalManifest, 'utf8'), f.data)
  }
  if (f.mode === 'root-symlink') {
    assert.equal((await lstat(f.requested)).isSymbolicLink(), true)
  }
}

function privacy(result) {
  assert.doesNotMatch(result.stdout + result.stderr,
    /only-fictional-local-data|synthetic-source|synthetic-shop|example\.invalid|supa-m5-manifest-alias/)
}

test('control: local regular manifest and regular capture file produce only a P2 manual queue', async () => {
  const f = await prepare('regular')
  try {
    const r = run(f.requested)
    assert.equal(r.status, 0, r.stderr)
    const report = JSON.parse(r.stdout)
    assert.equal(report.actions[0].priority, 'P2')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(report.rightsVerified, false)
    assert.equal(report.selectorVerified, false)
    privacy(r)
    await unchanged(f)
  } finally { await rm(f.outer, { recursive: true, force: true }) }
})

for (const mode of ['manifest-symlink', 'root-symlink']) {
  test(`expected RED #2168: ${mode} cannot certify an owned offline M1 capture`, async () => {
    const f = await prepare(mode)
    try {
      const r = run(f.requested)
      assert.notEqual(r.status, 0, 'aliased manifest provenance cannot yield a human review queue')
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /^Offline review failed: invalid capture or report\n$/)
      privacy(r)
      await unchanged(f)
    } finally { await rm(f.outer, { recursive: true, force: true }) }
  })
}
