import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// Independent, local-only QA of source-ownership boundaries. This does not
// modify the original product tests or claim descriptor-pinned atomicity.
const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const HTML = '<!doctype html><html><body>fictional immutable local file</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const STORE = 'fictional-market'
const ID = 'fictional-product'

async function capture(root, name, { at = '2026-10-13T10:00:00Z', failed = false, malformed = false } = {}) {
  const dir = join(root, name)
  const market = join(dir, STORE)
  await mkdir(market, { recursive: true })
  const html = join(market, ID + '.html')
  if (!failed) await writeFile(html, HTML)
  const manifest = join(dir, 'manifest.json')
  const value = malformed ? '{invalid JSON, do not read until root validated' : JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: ID, supermarket: STORE, kind: 'product', success: !failed,
      requestedUrl: 'https://example.invalid/synthetic',
      ...(failed ? {} : { capturedAt: at, sha256: SHA }),
    }],
  })
  await writeFile(manifest, value)
  return { dir, html, manifest, body: value, failed, malformed }
}

function run(current, previous = null) {
  const args = ['--experimental-strip-types', cli, current, ...(previous ? [previous] : [])]
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
  })
  assert.equal(r.error, undefined, 'a process timeout/spawn error is not a safe rejection')
  assert.equal(r.signal, null, 'a signal kill is not a safe rejection')
  assert.doesNotMatch(r.stdout + r.stderr, /fictional-product|fictional-market|example\.invalid|fictional immutable|supa-qa-m5-links-/)
  return r
}
function rejects(r) {
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}
function manual(r, expectedPriority, status, count = 1) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const report = JSON.parse(r.stdout)
  assert.equal(report.actions.length, count)
  assert.equal(report.actions[0].priority, expectedPriority)
  assert.equal(report.actions[0].status, status)
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  assert.equal(report.rightsVerified, false)
  assert.equal(report.selectorVerified, false)
  for (const action of report.actions) {
    assert.equal(action.productionEnabled, false)
    assert.equal(action.rightsVerified, false)
    assert.equal(action.selectorVerified, false)
  }
}
async function verify(...inputs) {
  for (const f of inputs) {
    assert.equal(await readFile(f.manifest, 'utf8'), f.body)
    if (!f.failed) {
      assert.equal(createHash('sha256').update(await readFile(f.html)).digest('hex'), SHA)
    }
  }
}
async function fixtureRun(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-m5-links-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function hardlinkReplace(from, to) {
  await rm(to)
  await link(from, to)
  const a = await lstat(from)
  const b = await lstat(to)
  assert.equal(a.ino, b.ino)
  assert.equal(a.dev, b.dev)
  assert.equal(a.nlink, 2)
  assert.equal(b.nlink, 2)
}

test('independent: two regular genuinely separate captures preserve historical private P3', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'now')
    const old = await capture(root, 'old', { at: '2026-10-12T10:00:00Z' })
    manual(run(now.dir, old.dir), 'P3', 'unchanged')
    assert.equal((await lstat(now.html)).nlink, 1)
    assert.equal((await lstat(old.html)).nlink, 1)
    await verify(now, old)
  })
})

test('independent: ordinary SHA-valid current capture remains P2 without baseline', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'now')
    manual(run(now.dir), 'P2', 'baseline_missing')
    await verify(now)
  })
})

test('independent: genuinely failed source remains P1 without requiring HTML', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'failed', { failed: true })
    manual(run(now.dir), 'P1', 'unavailable')
    await verify(now)
  })
})

test('independent: hardlinked HTML shared by otherwise distinct current and historical capture roots fails entire comparison', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'now')
    const old = await capture(root, 'old', { at: '2026-10-12T10:00:00Z' })
    await hardlinkReplace(now.html, old.html)
    rejects(run(now.dir, old.dir))
    rejects(run(old.dir, now.dir))
    await verify(now, old)
  })
})

test('independent: hardlinked manifest shared by distinct capture roots fails regardless of valid timestamps', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'now')
    const old = await capture(root, 'old', { at: '2026-10-12T10:00:00Z' })
    await hardlinkReplace(now.manifest, old.manifest)
    // Both manifests now contain the same current-time data. File provenance
    // must be rejected even though raw JSON is syntactically valid.
    old.body = now.body
    rejects(run(now.dir, old.dir))
    await verify(now, old)
  })
})

test('independent: borrowed hardlinked manifest of a failed capture is still rejected before P1', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'failed', { failed: true })
    const alias = join(root, 'borrowed-manifest.json')
    await link(now.manifest, alias)
    assert.equal((await lstat(now.manifest)).nlink, 2)
    rejects(run(now.dir))
    await verify(now)
    assert.equal(await readFile(alias, 'utf8'), now.body)
  })
})

test('independent: aliased current root with malformed JSON fails as root-origin error before parsing manifest', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'now', { malformed: true })
    const alias = join(root, 'alias-current')
    await symlink(now.dir, alias, 'dir')
    await assert.rejects(compareCaptureDirectories(alias), (err) =>
      err instanceof Error && err.message === 'Invalid offline capture tree origin')
    rejects(run(alias))
    await verify(now)
  })
})

test('independent: aliased historical root is rejected BEFORE malformed current manifest can be read', async () => {
  await fixtureRun(async root => {
    const now = await capture(root, 'now', { malformed: true })
    const old = await capture(root, 'old')
    const alias = join(root, 'alias-old')
    await symlink(old.dir, alias, 'dir')
    await assert.rejects(compareCaptureDirectories(now.dir, alias), (err) =>
      err instanceof Error && err.message === 'Invalid offline capture tree origin')
    rejects(run(now.dir, alias))
    await verify(now, old)
  })
})
