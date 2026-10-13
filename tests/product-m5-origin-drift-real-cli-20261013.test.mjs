import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Real CLI chain, but two invented HTML capture manifests written to a
// temporary directory. No HTTP requests, retailer rights or live observations.
const CLI = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const html = '<!doctype html><html><head><title>Fictional</title></head><body>offline only</body></html>'
const sha = createHash('sha256').update(html).digest('hex')

async function capture(root, name, { supermarket = 'fictional-a', kind = 'product' } = {}) {
  const directory = join(root, name)
  await mkdir(join(directory, supermarket), { recursive: true })
  await writeFile(join(directory, supermarket, 'stable-id.html'), html)
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: 'stable-id', supermarket, kind, success: true,
      requestedUrl: 'https://example.invalid/offline',
      capturedAt: '2026-10-13T00:00:00.000Z',
      sha256: sha,
    }],
  }))
  return directory
}

test('real offline review CLI ranks changed supermarket/capture kind as P1, never prints source metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-origin-integrity-'))
  try {
    const before = await capture(root, 'before')
    for (const [type, origin] of [
      ['market', { supermarket: 'fictional-b' }],
      ['category', { kind: 'category' }],
      ['identical', {}],
    ]) {
      const latest = await capture(root, type, origin)
      const original = await readFile(join(latest, 'manifest.json'), 'utf8')
      const proc = spawnSync(process.execPath,
        ['--experimental-strip-types', CLI, latest, before],
        { encoding: 'utf8', timeout: 10_000 },
      )
      assert.equal(proc.status, 0, proc.stderr)
      assert.equal(proc.stderr, '')
      const data = JSON.parse(proc.stdout)
      const drifted = type !== 'identical'
      assert.equal(data.driftCount, drifted ? 1 : 0)
      assert.deepEqual(data.actions.map(x => [x.status, x.priority, x.productionEnabled]),
        [[drifted ? 'origin_changed' : 'unchanged', drifted ? 'P1' : 'P3', false]])
      assert.equal(data.m5Eligible, false)
      assert.equal(data.rightsVerified, false)
      assert.equal(data.selectorVerified, false)
      assert.match(data.actions[0].sourceToken, /^[a-f0-9]{64}$/)
      assert.doesNotMatch(proc.stdout, /fictional-a|fictional-b|stable-id|example\.invalid/)
      assert.equal(await readFile(join(latest, 'manifest.json'), 'utf8'), original)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
