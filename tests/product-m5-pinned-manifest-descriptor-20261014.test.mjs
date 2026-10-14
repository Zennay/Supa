import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>invented offline bytes</body></html>'
const sha = createHash('sha256').update(html).digest('hex')
const manifest = (at = '2026-10-13T12:00:00.000Z') => JSON.stringify({
  milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
  results: [{
    id: 'invented-item', supermarket: 'invented-shop', kind: 'product',
    success: true, requestedUrl: 'https://example.invalid/manual',
    sha256: sha, capturedAt: at,
  }],
})

async function capture(root, folder, mode = 'normal', time = '2026-10-13T12:00:00.000Z') {
  const directory = join(root, folder)
  const market = join(directory, 'invented-shop')
  const external = join(root, folder + '-external')
  await mkdir(market, { recursive: true })
  await mkdir(external)
  await writeFile(join(market, 'invented-item.html'), html)
  const body = manifest(time)
  const local = join(directory, 'manifest.json')
  const outside = join(external, 'manifest.json')
  await writeFile(outside, body)
  if (mode === 'symlink') await symlink(outside, local)
  else if (mode === 'hardlink') await link(outside, local)
  else await writeFile(local, body)
  return { directory, local, outside, body, mode }
}

function execute(current, historical = null) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, current.directory,
    ...(historical ? [historical.directory] : []),
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /invented-item|invented-shop|example\.invalid|invented offline|supa-product-fd-m5/)
  return r
}

async function intact(...samples) {
  for (const s of samples) {
    assert.equal(await readFile(s.local, 'utf8'), s.body)
    assert.equal(await readFile(s.outside, 'utf8'), s.body)
    if (s.mode === 'symlink') assert.equal((await lstat(s.local)).isSymbolicLink(), true)
    if (s.mode === 'hardlink') assert.equal((await lstat(s.local)).nlink, 2)
  }
}
function denied(r) {
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
}
function manual(r, status) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const queue = JSON.parse(r.stdout)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].status, status)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
}

test('product: file-descriptor validated ordinary manifest remains manual P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fd-m5-'))
  try {
    const now = await capture(root, 'now')
    manual(execute(now), 'baseline_missing')
    await intact(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: independent older physical manifest remains manual P3', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fd-m5-'))
  try {
    const now = await capture(root, 'now')
    const older = await capture(root, 'older', 'normal', '2026-10-12T12:00:00.000Z')
    manual(execute(now, older), 'unchanged')
    await intact(now, older)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: nofollow descriptor refuses a symlinked current M1 manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fd-m5-'))
  try {
    const now = await capture(root, 'now', 'symlink')
    denied(execute(now))
    await intact(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: nofollow descriptor refuses symlinked historical manifest too', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fd-m5-'))
  try {
    const now = await capture(root, 'now')
    const older = await capture(root, 'older', 'symlink', '2026-10-12T12:00:00.000Z')
    denied(execute(now, older))
    await intact(now, older)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: descriptor stat refuses hardlinked current M1 manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fd-m5-'))
  try {
    const now = await capture(root, 'now', 'hardlink')
    denied(execute(now))
    await intact(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('product: descriptor stat refuses hardlinked historical M1 manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fd-m5-'))
  try {
    const now = await capture(root, 'now')
    const older = await capture(root, 'older', 'hardlink', '2026-10-12T12:00:00.000Z')
    denied(execute(now, older))
    await intact(now, older)
  } finally { await rm(root, { recursive: true, force: true }) }
})
