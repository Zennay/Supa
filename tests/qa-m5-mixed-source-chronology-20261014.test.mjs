import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Independent per-source multi-record companion to #2173's frozen 6-case QA.
// A single corrupt historical timestamp must not be hidden by other valid rows.
const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
const html = '<!doctype html><html><body>fake two-source fixture</body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const ids = ['fictional-one', 'fictional-two']
const store = 'fictional-store'

async function createCapture(root, folder, times) {
  const directory = join(root, folder)
  await mkdir(join(directory, store), { recursive: true })
  const files = []
  const records = []
  for (let i = 0; i < ids.length; i++) {
    const file = join(directory, store, ids[i] + '.html')
    await writeFile(file, html)
    files.push(file)
    records.push({
      id: ids[i], supermarket: store, kind: 'product',
      success: true, sha256: sha,
      requestedUrl: 'https://example.invalid/fictional',
      ...(times[i] === null ? {} : { capturedAt: times[i] }),
    })
  }
  const manifest = join(directory, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: records.length, results: records,
  })
  await writeFile(manifest, raw)
  return { directory, manifest, files, raw }
}

function run(now, before) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.directory, before.directory,
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-one|fictional-two|fictional-store|example\.invalid|supa-m5-two-source-chronology/)
  return r
}

async function untouched(...items) {
  for (const item of items) {
    assert.equal(await readFile(item.manifest, 'utf8'), item.raw)
    for (const file of item.files) {
      assert.equal(await readFile(file, 'utf8'), html)
      assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), sha)
    }
  }
}

const CURRENT = ['2026-10-13T11:00:00Z', '2026-10-13T11:00:00Z']
const OLDER = ['2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z']

test('positive: two independent strictly older source observations are private P3 manual only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-two-source-chronology-'))
  try {
    const before = await createCapture(root, 'older', OLDER)
    const now = await createCapture(root, 'current', CURRENT)
    const r = run(now, before)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stderr, '')
    const review = JSON.parse(r.stdout)
    assert.equal(review.actions.length, 2)
    assert.equal(review.actions.every(a => a.status === 'unchanged' &&
      a.priority === 'P3' && a.productionEnabled === false), true)
    assert.equal(review.productionReady, false)
    assert.equal(review.m5Eligible, false)
    assert.equal(review.rightsVerified, false)
    assert.equal(review.selectorVerified, false)
    await untouched(now, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const [caseName, timestamps] of [
  ['one of two baseline sources observed AFTER current', [OLDER[0], '2026-10-13T12:00:00Z']],
  ['one of two baseline sources has no capturedAt', [OLDER[0], null]],
]) {
  test('expected RED #2173: ' + caseName + ' invalidates the entire review queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supa-m5-two-source-chronology-'))
    try {
      const before = await createCapture(root, 'older', timestamps)
      const now = await createCapture(root, 'current', CURRENT)
      const r = run(now, before)
      assert.notEqual(r.status, 0,
        'one temporally untrusted source must not be disguised by other valid sources')
      assert.equal(r.stdout, '', 'must refuse entire private JSON queue')
      assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
      await untouched(now, before)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
