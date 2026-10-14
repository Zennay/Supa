import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Independent product-policy oracle: exact 32 MiB capture-tree boundary.
// Does NOT replace the stricter unchanged historical 8 MiB-total QA #2166.
const CLI = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const EACH = 8 * 1024 * 1024
const TOTAL = 32 * 1024 * 1024
const PREFIX = '<!doctype html><html><body>'
const SUFFIX = '</body></html>'
const SHOP = 'synthetic-only-store'

function htmlOfExactBytes(bytes) {
  const framingBytes = Buffer.byteLength(PREFIX + SUFFIX)
  assert.ok(bytes >= framingBytes)
  const html = PREFIX + 'x'.repeat(bytes - framingBytes) + SUFFIX
  assert.equal(Buffer.byteLength(html), bytes)
  return html
}

async function makeCapture(sizes) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-exact-32m-'))
  const market = join(root, SHOP)
  await mkdir(market)
  const rows = []
  const files = []
  for (let i = 0; i < sizes.length; i++) {
    const id = 'synthetic-entry-' + (i + 1)
    const html = htmlOfExactBytes(sizes[i])
    const path = join(market, id + '.html')
    const sha = createHash('sha256').update(html).digest('hex')
    await writeFile(path, html)
    files.push({ path, size: sizes[i], sha })
    rows.push({
      id,
      supermarket: SHOP,
      kind: 'product',
      success: true,
      requestedUrl: 'https://example.invalid/offline-only',
      capturedAt: '2026-10-13T10:00:00.000Z',
      sha256: sha,
    })
  }
  const manifest = join(root, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility',
    bounded: true,
    sourceCount: rows.length,
    results: rows,
  })
  await writeFile(manifest, raw)
  return { root, manifest, raw, files }
}

function runCLI(root) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', CLI, root], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
  assert.equal(result.error, undefined, 'a spawn or timeout error cannot count as normal refusal')
  assert.equal(result.signal, null, 'a kill signal cannot count as normal refusal')
  assert.doesNotMatch(result.stdout + result.stderr,
    /synthetic-entry-|synthetic-only-store|example\.invalid|supa-qa-exact-32m-/)
  return result
}

async function checkUnchanged(input) {
  assert.equal(await readFile(input.manifest, 'utf8'), input.raw)
  for (const file of input.files) {
    assert.equal((await stat(file.path)).size, file.size)
    const actual = createHash('sha256').update(await readFile(file.path)).digest('hex')
    assert.equal(actual, file.sha)
  }
}

test('new owner-policy control: exactly 4 x 8 MiB SHA-verified files is 32 MiB and remains P2 manual-only', async () => {
  const sizes = [EACH, EACH, EACH, EACH]
  assert.equal(sizes.reduce((a, b) => a + b, 0), TOTAL)
  const input = await makeCapture(sizes)
  try {
    const out = runCLI(input.root)
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.stderr, '')
    const review = JSON.parse(out.stdout)
    assert.equal(review.actions.length, 4)
    assert.equal(review.sourceCount, 4)
    for (const action of review.actions) {
      assert.equal(action.priority, 'P2')
      assert.equal(action.productionEnabled, false)
      assert.equal(action.rightsVerified, false)
      assert.equal(action.selectorVerified, false)
    }
    assert.equal(review.productionReady, false)
    assert.equal(review.m5Eligible, false)
    assert.equal(review.rightsVerified, false)
    assert.equal(review.selectorVerified, false)
    await checkUnchanged(input)
  } finally {
    await rm(input.root, { recursive: true, force: true })
  }
})

test('new owner-policy control: 32 MiB plus one tiny complete HTML must refuse entire private review before publishing JSON', async () => {
  const sizes = [EACH, EACH, EACH, EACH, Buffer.byteLength(PREFIX + SUFFIX)]
  assert.ok(sizes.every(size => size <= EACH))
  assert.ok(sizes.reduce((a, b) => a + b, 0) > TOTAL)
  const input = await makeCapture(sizes)
  try {
    const out = runCLI(input.root)
    assert.notEqual(out.status, 0)
    assert.equal(out.stdout, '')
    assert.equal(out.stderr, 'Offline review failed: invalid capture or report\n')
    await checkUnchanged(input)
  } finally {
    await rm(input.root, { recursive: true, force: true })
  }
})
