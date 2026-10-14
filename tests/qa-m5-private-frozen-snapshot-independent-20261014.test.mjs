import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  access, link, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'
import { inspectFrozenCaptureDirectory } from '../scripts/m5-inspect-frozen-captures.mjs'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// All inputs are invented offline, no retailer, user, price or network.
const HTML = '<!doctype html><html><body>independent fictional product</body></html>'
const SHA = input => createHash('sha256').update(input).digest('hex')
const CLI = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const row = (id = 'same-one', changes = {}) => ({
  id, supermarket: 'fictional-market', kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/local-only',
  capturedAt: '2026-10-14T00:00:00.000Z', sha256: SHA(HTML), ...changes,
})
const failed = id => ({
  id, supermarket: 'fictional-market', kind: 'product', success: false,
  requestedUrl: 'https://example.invalid/unavailable',
})
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-independent-frozen-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function capture(root, name, records, files = {}) {
  const dir = join(root, name)
  await mkdir(dir)
  const manifest = {
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: records.length, results: records,
  }
  const manifestFile = join(dir, 'manifest.json')
  await writeFile(manifestFile, JSON.stringify(manifest))
  const stores = new Set()
  for (const source of records) {
    if (!source.success) continue
    const store = join(dir, source.supermarket)
    if (!stores.has(store)) {
      await mkdir(store)
      stores.add(store)
    }
    await writeFile(join(store, source.id + '.html'), files[source.id] ?? HTML)
  }
  return { dir, manifest, manifestFile, htmlPath: join(dir, 'fictional-market', records[0]?.id + '.html') }
}
function run(now, earlier) {
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, now.dir, ...(earlier ? [earlier.dir] : [])],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-market|example\.invalid|supa-independent-frozen-|independent fictional product|supa-m5-private-inspection-/)
  return r
}
function manual(r, priority, status) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const data = JSON.parse(r.stdout)
  assert.equal(data.actions.length, 1)
  assert.equal(data.actions[0].priority, priority)
  assert.equal(data.actions[0].status, status)
  assert.equal(data.actions[0].productionEnabled, false)
  for (const field of ['productionReady', 'rightsVerified', 'selectorVerified', 'm5Eligible']) {
    assert.equal(data[field], false)
  }
}
test('independent snapshot: current SHA-verified real CLI remains private P2', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    manual(run(now), 'P2', 'baseline_missing')
  })
})
test('independent snapshot: unavailable P1 needs no HTML and no SHA', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [failed('failed')])
    manual(run(now), 'P1', 'unavailable')
  })
})
test('independent snapshot: independently older root remains manual P3', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    const before = await capture(root, 'before',
      [row('same-one', { capturedAt: '2026-10-13T00:00:00.000Z' })])
    manual(run(now, before), 'P3', 'unchanged')
  })
})
test('independent snapshot: canonical inspector sees pinned HTML after original is rewritten', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    let inspectedPath
    const observed = await inspectFrozenCaptureDirectory(now.dir, now.manifest, async temp => {
      inspectedPath = temp
      await writeFile(now.htmlPath, '<html>changed original AFTER copy</html>')
      return inspectCaptureDirectory(temp)
    })
    assert.equal(observed.sources[0].integrity, 'verified')
    assert.equal(observed.sources[0].manifestSha256, SHA(HTML))
    assert.equal(await readFile(now.htmlPath, 'utf8'), '<html>changed original AFTER copy</html>')
    await assert.rejects(access(inspectedPath))
  })
})
test('independent snapshot: copied preflight manifest survives original manifest mutation', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    const snapshot = JSON.stringify(now.manifest)
    const result = await inspectFrozenCaptureDirectory(now.dir, now.manifest, async temp => {
      await writeFile(now.manifestFile, JSON.stringify({ tampered: true }))
      assert.equal(await readFile(join(temp, 'manifest.json'), 'utf8'), snapshot)
      return inspectCaptureDirectory(temp)
    })
    assert.equal(result.sources[0].integrity, 'verified')
    assert.equal(await readFile(now.manifestFile, 'utf8'), '{"tampered":true}')
  })
})
test('independent snapshot: private temporary tree and files have 0700/0600 permissions', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    await inspectFrozenCaptureDirectory(now.dir, now.manifest, async temp => {
      const modes = await Promise.all([
        stat(temp), stat(join(temp, 'manifest.json')),
        stat(join(temp, 'fictional-market')),
        stat(join(temp, 'fictional-market', 'same-one.html')),
      ])
      assert.deepEqual(modes.map(x => x.mode & 0o777),
        [0o700, 0o600, 0o700, 0o600])
      return inspectCaptureDirectory(temp)
    })
  })
})
test('independent snapshot: returned private root is removed after successful inspection', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    let temp
    await inspectFrozenCaptureDirectory(now.dir, now.manifest, async dir => {
      temp = dir
      return inspectCaptureDirectory(dir)
    })
    assert.ok(temp)
    await assert.rejects(access(temp))
  })
})
test('independent snapshot: private root is removed after injected inspection failure', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    let temp
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest, async dir => {
      temp = dir
      throw new Error('fictional injected inspection failure')
    }), /fictional injected inspection failure/)
    assert.ok(temp)
    await assert.rejects(access(temp))
  })
})
test('independent snapshot: SHA mismatch refuses direct frozen inspection and private CLI', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [
      row('same-one', { sha256: '0'.repeat(64) }),
    ])
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /Capture integrity mismatch/)
    const r = run(now)
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
  })
})
test('independent snapshot: symlinked source HTML is rejected without revealing paths', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    const target = join(root, 'external.html')
    await writeFile(target, HTML)
    await rm(now.htmlPath)
    await symlink(target, now.htmlPath)
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /Invalid frozen offline capture source/)
    const r = run(now)
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
  })
})
test('independent snapshot: hardlinked source HTML is rejected even when SHA matches', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    await link(now.htmlPath, join(root, 'borrowed-hardlink.html'))
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /Invalid frozen offline capture source/)
  })
})
test('independent snapshot: symlinked store directory is not followed', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row()])
    const external = join(root, 'external-store')
    await mkdir(external)
    await writeFile(join(external, 'same-one.html'), HTML)
    await rm(join(now.dir, 'fictional-market'), { recursive: true })
    await symlink(external, join(now.dir, 'fictional-market'))
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /Invalid frozen offline capture source/)
  })
})
test('independent snapshot: SHA-matching malformed UTF8 source bytes are refused', async () => {
  await isolated(async root => {
    const bad = Buffer.concat([Buffer.from('<html>'), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from('</html>')])
    const now = await capture(root, 'now', [
      row('same-one', { sha256: SHA(bad) }),
    ], { 'same-one': bad })
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /Invalid frozen offline capture source/)
  })
})
test('independent snapshot: two individually-bounded HTML files over total 8MiB are refused', async () => {
  await isolated(async root => {
    const large = '<html>' + 'a'.repeat(5 * 1024 * 1024) + '</html>'
    const rows = [row('first', { sha256: SHA(large) }),
      row('second', { sha256: SHA(large) })]
    const now = await capture(root, 'now', rows, { first: large, second: large })
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      /Invalid frozen offline capture source/)
  })
})
test('independent snapshot: late invalid identity rejected before any original HTML I/O', async () => {
  await isolated(async root => {
    const now = await capture(root, 'now', [row(), failed('a'.repeat(129))])
    await rm(now.htmlPath) // if valid row HTML read first, wrong ENOENT error
    await assert.rejects(inspectFrozenCaptureDirectory(now.dir, now.manifest),
      err => err instanceof Error && err.message === 'Invalid frozen offline capture source')
  })
})
