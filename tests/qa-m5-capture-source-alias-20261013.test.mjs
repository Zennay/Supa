import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const reviewCli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const STORE = 'fictional'
const ID = 'fictional-item'
const RESTRICTED_URL = 'https://example.invalid/offline-source'
const HTML = '<!doctype html><html><body>SYNTHETIC_LOCAL_HTML_ONLY</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')

async function fixture(mode = 'regular') {
  const outer = await mkdtemp(join(tmpdir(), 'supa-m5-source-alias-'))
  const root = join(outer, 'capture')
  const external = join(outer, 'external')
  await mkdir(root)
  await mkdir(external)
  const outside = join(external, ID + '.html')
  await writeFile(outside, HTML)
  const insideStore = join(root, STORE)
  const insideHtml = join(insideStore, ID + '.html')
  if (mode === 'folder-link') {
    await symlink(external, insideStore, 'dir')
  } else {
    await mkdir(insideStore)
    if (mode === 'file-link') await symlink(outside, insideHtml, 'file')
    else if (mode !== 'failed') await writeFile(insideHtml, HTML)
  }

  const manifest = join(root, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: ID, supermarket: STORE, kind: 'product',
      requestedUrl: RESTRICTED_URL,
      capturedAt: '2026-10-13T00:00:00.000Z',
      success: mode !== 'failed',
      ...(mode !== 'failed' ? { sha256: SHA } : {}),
    }],
  })
  await writeFile(manifest, raw)
  return { outer, root, external, outside, insideStore, insideHtml, manifest, raw, mode }
}

function run(current, baseline = null) {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', reviewCli, current.root,
      ...(baseline ? [baseline.root] : [])],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000 })
  assert.equal(result.error, undefined, 'test may not substitute timeout for a valid rejection')
  assert.equal(result.signal, null, 'signal termination cannot count as safe input refusal')
  return result
}

async function untouched(...fixtures) {
  for (const input of fixtures) {
    assert.equal(await readFile(input.manifest, 'utf8'), input.raw)
    assert.equal(await readFile(input.outside, 'utf8'), HTML)
    if (input.mode === 'file-link') assert.equal((await lstat(input.insideHtml)).isSymbolicLink(), true)
    if (input.mode === 'folder-link') assert.equal((await lstat(input.insideStore)).isSymbolicLink(), true)
    if (input.mode === 'regular') assert.equal(await readFile(input.insideHtml, 'utf8'), HTML)
  }
}

function assertManualOnly(result, priority) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const queue = JSON.parse(result.stdout)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, priority)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.actions[0].productionEnabled, false)
  assert.doesNotMatch(result.stdout, /SYNTHETIC_LOCAL_HTML_ONLY|fictional-item|example\.invalid|supa-m5-source-alias/)
}

function assertRejectsAlias(result) {
  assert.notEqual(result.status, 0, 'a SHA-matching symlink is not an owned regular capture')
  assert.equal(result.stdout, '', 'unsafe alias must not emit a review queue')
  assert.match(result.stderr, /^Offline review failed: invalid capture or report\n$/)
  assert.doesNotMatch(result.stderr, /SYNTHETIC_LOCAL_HTML_ONLY|fictional-item|example\.invalid|supa-m5-source-alias/)
}

test('positive: real local regular HTML with matching SHA remains P2 manual preparation only', async () => {
  const f = await fixture('regular')
  try {
    assertManualOnly(run(f), 'P2')
    await untouched(f)
  } finally { await rm(f.outer, { recursive: true, force: true }) }
})

test('positive: genuine failed capture stays P1 without requiring an HTML file', async () => {
  const f = await fixture('failed')
  try {
    assertManualOnly(run(f), 'P1')
    await untouched(f)
  } finally { await rm(f.outer, { recursive: true, force: true }) }
})

test('expected RED #2168: final HTML symlink escaping capture root must be refused', async () => {
  const f = await fixture('file-link')
  try {
    assertRejectsAlias(run(f))
    await untouched(f)
  } finally { await rm(f.outer, { recursive: true, force: true }) }
})

test('expected RED #2168: supermarket-folder symlink escaping capture root must be refused', async () => {
  const f = await fixture('folder-link')
  try {
    assertRejectsAlias(run(f))
    await untouched(f)
  } finally { await rm(f.outer, { recursive: true, force: true }) }
})

test('expected RED #2168: baseline alias must not be accepted when current capture is regular', async () => {
  const current = await fixture('regular')
  const baseline = await fixture('folder-link')
  try {
    assertRejectsAlias(run(current, baseline))
    await untouched(current, baseline)
  } finally {
    await rm(current.outer, { recursive: true, force: true })
    await rm(baseline.outer, { recursive: true, force: true })
  }
})
