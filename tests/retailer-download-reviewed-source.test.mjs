import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, stat, rm, chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main, cleanupOnlyOwnSnapshotFile } from '../scripts/retailer-download-reviewed-source.mjs'
import { main as inspect } from '../scripts/retailer-inspect-snapshot-cli.mjs'
import { replayPrivateSelectorHtmlSnapshot } from '../scripts/retailer-replay-private-html-product.mjs'

const url = 'https://www.plus.nl/producten'
const grant = {
  supermarket: 'plus', kind: 'catalog', sourceUrl: url,
  reviewed: true, termsReviewed: true, robotsReviewed: true,
  noAntiBotBypass: true,
}
const gate = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-14',
  sources: [
    { supermarket: 'plus', technicalStatus: 'proven',
      permissionStatus: 'permitted', productionEnabled: true,
      evidence: [{ kind: 'written_permission',
        url: 'https://example.test/synthetic-license-only',
        finding: 'CI test-only fake; never a real retailer license' }] },
    { supermarket: 'dekamarkt', technicalStatus: 'proven',
      permissionStatus: 'unresolved', productionEnabled: false,
      evidence: [{ kind: 'official_terms', url: 'https://www.dekamarkt.nl/algemene-voorwaarden',
        finding: 'No rights' }] },
  ],
}

async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'supa-capture-gate-'))
  const grantFile = join(dir, 'synthetic-grant.json')
  await writeFile(grantFile, JSON.stringify(grant))
  return { dir, grantFile }
}

test('pinned canonical M1 gate denies real source capture BEFORE any network or output', async () => {
  const { dir, grantFile } = await temp()
  try {
    let fetched = false
    const out = join(dir, 'out', 'capture.html')
    await assert.rejects(main([grantFile, out], {
      fetchFn: async () => { fetched = true; throw new Error('MUST NOT FETCH') },
      writeOutput: () => { throw new Error('must not publish') },
    }), /Explicit retailer source permission required/)
    assert.equal(fetched, false)
    await assert.rejects(stat(out), /ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('synthetic explicit approved capture archives private HTML plus SHA manifest; offline selector CLI reuses it', async () => {
  const { dir, grantFile } = await temp()
  try {
    const out = join(dir, 'ignored-artifacts', 'capture.html')
    const html = '<html><body><a href="/product/test-123" class="product-card">FICTIONAL PRIVATE PRODUCT</a><span class="price-value">€1,99</span></body></html>'
    const sha = createHash('sha256').update(html).digest('hex')
    let printed = ''
    let requests = 0
    const manifest = await main([grantFile, out], {
      testGateDocument: gate,
      fetchFn: async (target, config) => {
        requests++
        assert.equal(target, url)
        assert.equal(config.redirect, 'error')
        assert.equal(config.credentials, 'omit')
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
      },
      writeOutput: t => { printed += t },
    })
    assert.equal(requests, 1)
    assert.equal(manifest.source.sha256, sha)
    assert.equal(manifest.releaseReady, false)
    assert.equal(manifest.status, 'private-review-required')
    assert.deepEqual(JSON.parse(await readFile(out + '.manifest.json', 'utf8')), manifest)
    assert.equal(await readFile(out, 'utf8'), html)
    assert.equal((await stat(out)).mode & 0o777, 0o600)
    assert.equal((await stat(out + '.manifest.json')).mode & 0o777, 0o600)
    assert.doesNotMatch(printed, /FICTIONAL|€|www.plus.nl|sourceUrl|user@/i)
    assert.equal(JSON.parse(printed).sha256, sha)
    let proposal = ''
    const result = await inspect(['plus', url, manifest.source.capturedAt, sha, out], t => { proposal += t })
    assert.equal(result.source.sha256, sha)
    assert.ok(result.selectors.some(x => x.selector === 'a[href^="/product/"]'))
    assert.ok(result.selectors.some(x => x.field === 'price'))
    assert.equal(result.productionEnabled, false)
    assert.doesNotMatch(proposal, /FICTIONAL PRIVATE PRODUCT|€1,99/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('existing private source or sibling manifest blocks fetch and preserves existing files', async () => {
  const { dir, grantFile } = await temp()
  try {
    const out = join(dir, 'capture.html')
    await writeFile(out, 'IMMUTABLE')
    let fetched = false
    await assert.rejects(main([grantFile, out], {
      testGateDocument: gate,
      fetchFn: async () => { fetched = true; throw Error('must not fetch') },
    }), /already exists/)
    assert.equal(fetched, false)
    assert.equal(await readFile(out, 'utf8'), 'IMMUTABLE')
    await rm(out)
    await writeFile(out + '.manifest.json', 'IMMUTABLE-MANIFEST')
    await assert.rejects(main([grantFile, out], {
      testGateDocument: gate,
      fetchFn: async () => { fetched = true; throw Error('must not fetch') },
    }), /already exists/)
    assert.equal(await readFile(out + '.manifest.json', 'utf8'), 'IMMUTABLE-MANIFEST')
    assert.equal(fetched, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('rejects unsafe output name and wrong arguments without network', async () => {
  const { dir, grantFile } = await temp()
  try {
    for (const path of [dir + '/../parent.html', join(dir, '.hidden.html'), join(dir, 'not-json.json')]) {
      await assert.rejects(main([grantFile, path], { testGateDocument: gate }), /Invalid private snapshot output name/)
    }
    await assert.rejects(main([]), /Usage:/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})


test('a preexisting world-listable output directory must block fetch before transport', async () => {
  const { dir, grantFile } = await temp()
  try {
    const publicDir = join(dir, 'shared')
    await mkdir(publicDir)
    await chmod(publicDir, 0o755)
    const output = join(publicDir, 'capture.html')
    let requests = 0
    await assert.rejects(main([grantFile, output], {
      testGateDocument: gate,
      fetchFn: async () => {
        requests++
        return new Response('<html>fictional</html>', {
          headers: { 'content-type': 'text/html' },
        })
      },
    }), /[Uu]ntrusted private snapshot parent/)
    assert.equal(requests, 0)
    await assert.rejects(stat(output), /ENOENT/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('authorized synthetic catalog capture reopens through private selector replay end-to-end', async () => {
  const { dir, grantFile } = await temp()
  try {
    const out = join(dir, 'secure', 'capture.html')
    await main([grantFile, out], {
      testGateDocument: gate, writeOutput() {},
      fetchFn: async () => new Response(
        '<html><article class="product-card">Fictional private listing</article></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    const result = await replayPrivateSelectorHtmlSnapshot(out)
    assert.equal(result.source.kind, 'catalog')
    assert.equal(result.proposals.selectors[0].field, 'product')
    assert.equal(result.published, false)
    assert.equal(result.priceExtractionEnabled, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})


test('failed-capture cleanup cannot delete a competing replacement or unowned symlink', async () => {
  const { dir } = await temp()
  try {
    const output = join(dir, 'capture.html')
    await writeFile(output, 'first-private-original', { mode: 0o600 })
    const inode = await stat(output)
    await rm(output)
    await writeFile(output, 'other-writer-content', { mode: 0o600 })
    await cleanupOnlyOwnSnapshotFile(output, inode)
    assert.equal(await readFile(output, 'utf8'), 'other-writer-content')

    const original = await stat(output)
    await cleanupOnlyOwnSnapshotFile(output, original)
    await assert.rejects(stat(output), /ENOENT/)

    const alternate = join(dir, 'alternative.html')
    await writeFile(alternate, 'should-stay', { mode: 0o600 })
    const { symlink } = await import('node:fs/promises')
    await symlink(alternate, output)
    await cleanupOnlyOwnSnapshotFile(output, await stat(alternate))
    assert.equal(await readFile(alternate, 'utf8'), 'should-stay')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('truncated 200 HTML never leaves a private snapshot; valid retry archives exact UTF-8 source', async () => {
  const {dir, grantFile} = await temp()
  try {
    const filename = join(dir, 'secure', 'catalog.html')
    const html = '<html><body><article class="product-card">SYNTHETIC café only</article></body></html>'
    const bytes = Buffer.byteLength(html, 'utf8')
    let calls = 0
    const fetchFn = async (_url, options) => {
      calls++
      assert.equal(options.redirect, 'error')
      return new Response(html, {status: 200, headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(calls === 1 ? bytes + 3 : bytes),
      }})
    }
    await assert.rejects(main([grantFile, filename], {
      testGateDocument: gate, fetchFn, writeOutput() {},
    }), /Incomplete HTML capture/)
    await assert.rejects(stat(filename), /ENOENT/)
    await assert.rejects(stat(filename + '.manifest.json'), /ENOENT/)
    const saved = await main([grantFile, filename], {
      testGateDocument: gate, fetchFn, writeOutput() {},
    })
    assert.equal(calls, 2)
    assert.equal(saved.bytes, bytes)
    assert.equal(saved.source.sha256,
      createHash('sha256').update(html, 'utf8').digest('hex'))
    assert.equal((await stat(filename)).mode & 0o777, 0o600)
    assert.equal((await stat(filename + '.manifest.json')).mode & 0o777, 0o600)
    assert.equal(await readFile(filename, 'utf8'), html)
    const reviewed = await replayPrivateSelectorHtmlSnapshot(filename)
    assert.ok(reviewed.proposals.selectors.some(row =>
      row.selector === 'article.product-card'))
    assert.equal(reviewed.published, false)
    assert.equal(reviewed.priceExtractionEnabled, false)
  } finally {
    await rm(dir, {recursive: true, force: true})
  }
})
