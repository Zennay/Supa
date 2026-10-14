import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Independent aggregate-budget companion to #2165. Original four-case QA
// file is left byte-identical so later product replay can cite its exact blob.
const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const LIMIT = 8 * 1024 * 1024
const STORE = 'fictional-retailer'
const URL_LABEL = 'https://example.invalid/local-only'
const generated = (size) => '<!doctype html><html><body>' +
  'q'.repeat(size) + '</body></html>'

async function fixture(parts) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-aggregate-budget-'))
  const folder = join(root, STORE)
  await mkdir(folder)
  const results = []
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const id = 'synthetic-' + (i + 1)
    const name = join(folder, id + '.html')
    const html = generated(parts[i])
    const bytes = Buffer.byteLength(html, 'utf8')
    const sha = createHash('sha256').update(html).digest('hex')
    await writeFile(name, html)
    files.push({ name, bytes, sha })
    results.push({
      id, supermarket: STORE, kind: 'product', success: true,
      requestedUrl: URL_LABEL, capturedAt: '2026-10-13T00:00:00.000Z', sha256: sha,
    })
  }
  const manifest = join(root, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: results.length, results,
  })
  await writeFile(manifest, raw)
  return { root, manifest, raw, files }
}

function cliRun(root) {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', cli, root],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 })
  assert.equal(result.error, undefined, 'no timeout/spawn failure can count as a correct refusal')
  assert.equal(result.signal, null, 'no signal termination can count as fail-closed')
  return result
}

async function verifyUnchanged(f) {
  assert.equal(await readFile(f.manifest, 'utf8'), f.raw)
  for (const file of f.files) {
    assert.equal((await stat(file.name)).size, file.bytes)
    assert.equal(createHash('sha256').update(await readFile(file.name)).digest('hex'),
      file.sha, 'synthetic SHA-bound file must not be mutated')
  }
}

test('aggregate positive: two small independent verified sources remain human-only', async () => {
  const f = await fixture([64, 64])
  try {
    const out = cliRun(f.root)
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.stderr, '')
    const queue = JSON.parse(out.stdout)
    assert.equal(queue.sourceCount, 2)
    assert.equal(queue.actions.length, 2)
    assert.equal(queue.actions.every(a => a.priority === 'P2'), true)
    assert.equal(queue.m5Eligible, false)
    assert.equal(queue.productionReady, false)
    assert.equal(queue.selectorVerified, false)
    assert.equal(queue.rightsVerified, false)
    assert.doesNotMatch(out.stdout, /synthetic-|fictional-retailer|example\.invalid/)
    await verifyUnchanged(f)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('expected RED #2165: individually small SHA-verified HTML files must obey an aggregate 8 MiB budget', async () => {
  const f = await fixture([5 * 1024 * 1024, 5 * 1024 * 1024])
  try {
    assert.ok(f.files.every(file => file.bytes < LIMIT))
    assert.ok(f.files.reduce((sum, file) => sum + file.bytes, 0) > LIMIT)
    assert.ok(Buffer.byteLength(f.raw, 'utf8') < 2048)
    const out = cliRun(f.root)
    assert.notEqual(out.status, 0, 'small manifest + individually bounded files must not bypass total byte budget')
    assert.equal(out.stdout, '', 'no private review JSON on budget refusal')
    assert.match(out.stderr, /^Offline review failed: invalid capture or report\n$/)
    assert.doesNotMatch(out.stderr, /synthetic-|fictional-retailer|example\.invalid|supa-m5-aggregate-budget/)
    await verifyUnchanged(f)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
