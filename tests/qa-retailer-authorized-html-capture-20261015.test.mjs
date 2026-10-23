import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'
import { captureAuthorizedRetailerPage, saveAuthorizedRetailerCapture } from '../scripts/retailer-authorized-html-capture.mjs'
import { proposeFromM1CaptureDirectory } from '../scripts/retailer-snapshot-selector-proposals.mjs'

const plus = SOURCES.find(s => s.supermarket === 'plus' && s.kind === 'product')
const fixture = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const html = '<!doctype html><html><body><h1 class="product-name">Fictional shop</h1><span class="product-price">1.99</span></body></html>'

async function rights({ grantPlus = false } = {}) {
  const document = JSON.parse(await readFile(fixture, 'utf8'))
  if (grantPlus) {
    const r = document.sources.find(s => s.supermarket === 'plus')
    r.permissionStatus = 'permitted'
    r.productionEnabled = true
    r.evidence.push({
      kind: 'written_permission',
      url: 'https://www.plus.nl/fictional-permission-test-only',
      finding: 'synthetic permission fixture for bounded transport unit test ONLY',
    })
  }
  return document
}

test('capture preflight blocks current unlicensed PLUS and DekaMarkt BEFORE ANY network request', async t => {
  for (const source of [plus, SOURCES.find(s => s.supermarket === 'dekamarkt')]) {
    await t.test(source.id, async () => {
      let calls = 0
      await assert.rejects(
        captureAuthorizedRetailerPage({
          source, permissionDocument: await rights(),
          fetchImpl() { calls++; throw new Error('must not fetch when unlicensed') },
        }), /Retailer HTML capture refused/,
      )
      assert.equal(calls, 0)
    })
  }
})

test('mock authorization + bounded HTTP capture returns exact source SHA, time, no guessed prices or redirects', async () => {
  const authorized = await rights({ grantPlus: true })
  let calls = 0
  const capture = await captureAuthorizedRetailerPage({
    source: plus, permissionDocument: authorized,
    clock: new Date('2026-10-15T12:00:00Z'),
    fetchImpl: async (url, options) => {
      calls++
      assert.equal(url, plus.url)
      assert.equal(options.method, 'GET')
      assert.equal(options.redirect, 'manual')
      assert.equal(options.credentials, 'omit')
      assert.match(options.headers['user-agent'], /SUPA-authorized-capture/)
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html;charset=utf-8' } })
    },
  })
  assert.equal(calls, 1)
  assert.equal(capture.html, html)
  assert.equal(capture.metadata.capturedAt, '2026-10-15T12:00:00.000Z')
  assert.equal(capture.metadata.sha256, createHash('sha256').update(html).digest('hex'))
  assert.equal(capture.metadata.bytes, Buffer.byteLength(html))
  assert.equal(capture.metadata.success, true)
  assert.ok(!Object.hasOwn(capture.metadata, 'priceCents'))
})

test('HTTP capture rejects redirect, 403/429, binary, declared 3 MiB and actual >2 MiB', async t => {
  const granted = await rights({ grantPlus: true })
  const cases = [
    ['redirect', new Response(null, { status: 302, headers: { location: 'https://other.invalid/' } })],
    ['403', new Response('blocked', { status: 403 })],
    ['429', new Response('slow down', { status: 429 })],
    ['unexpected content type', new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['excess declared bytes', new Response('safe', { status: 200, headers: { 'content-type': 'text/html', 'content-length': String(3*1024*1024) } })],
    ['excess streamed bytes', new Response('x'.repeat(2*1024*1024+1), { status: 200, headers: { 'content-type': 'text/html' } })],
  ]
  for (const [name, response] of cases) {
    await t.test(name, async () => {
      await assert.rejects(captureAuthorizedRetailerPage({
        source: plus, permissionDocument: granted,
        fetchImpl: async () => response,
      }), /Retailer HTML capture refused/)
    })
  }
})

test('static allowlist blocks cross-chain URL injection, private APIs, encoded identities and forged license', async t => {
  const granted = await rights({ grantPlus: true })
  const cases = [
    ['unapproved host', s => { s.url = 'https://outside.invalid/product/1' }, granted],
    ['credential URL', s => { s.url = 'https://user:pw@www.plus.nl/product/1' }, granted],
    ['product wrong route', s => { s.url = 'https://www.plus.nl/api/graphql' }, granted],
    ['insecure HTTP', s => { s.url = 'http://www.plus.nl/product/1' }, granted],
    ['URL query token', s => { s.url += '?secret=x' }, granted],
    ['pretend deka rights', s => { s.supermarket = 'dekamarkt' }, granted],
    ['future review evidence', s => {}, { ...granted, reviewedAt: '2030-01-01' }],
  ]
  for (const [name, mutate, document] of cases) {
    await t.test(name, async () => {
      const source = structuredClone(plus)
      mutate(source)
      let fetchCount = 0
      await assert.rejects(captureAuthorizedRetailerPage({
        source, permissionDocument: document,
        fetchImpl: async () => { fetchCount++; return new Response(html, { status: 200 }) },
      }), /Retailer HTML capture refused/)
      assert.equal(fetchCount, 0)
    })
  }
})

test('permission-gated mocked save → real M1 SHA-bound selector tool works end-to-end and keeps files private', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'supa-permitted-capture-'))
  const dest = join(temp, 'new-run')
  try {
    const rightsDocument = await rights({ grantPlus: true })
    let count = 0
    const fetchImpl = async () => {
      count++
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    const result = await saveAuthorizedRetailerCapture({
      source: plus, permissionDocument: rightsDocument, destination: dest, fetchImpl,
    })
    assert.equal(result.captureSaved, true)
    assert.equal(result.productionReady, false)
    assert.equal(count, 1)
    assert.equal((await stat(dest)).mode & 0o777, 0o700)
    assert.equal((await stat(join(dest, 'manifest.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(join(dest, 'plus', plus.id + '.html'))).mode & 0o777, 0o600)
    const proposals = await proposeFromM1CaptureDirectory(dest)
    assert.equal(proposals.analyzedSources, 1)
    assert.ok(proposals.selectorSets[0].proposedSelectors.some(x => x.selector === 'h1.product-name'))
    assert.ok(proposals.selectorSets[0].proposedSelectors.some(x => x.selector === 'span.product-price'))
    assert.equal(proposals.automatedSelectorPromotion, false)
    await assert.rejects(saveAuthorizedRetailerCapture({
      source: plus, permissionDocument: rightsDocument, destination: dest,
      fetchImpl: async () => { count++; throw new Error('existing output must not fetch') },
    }), /Retailer HTML capture refused/)
    assert.equal(count, 1)
    const alias = join(temp, 'capture-alias')
    await symlink(dest, alias)
    await assert.rejects(saveAuthorizedRetailerCapture({
      source: plus, permissionDocument: rightsDocument, destination: alias,
      fetchImpl: async () => { count++; throw new Error('symlink output must not fetch') },
    }), /Retailer HTML capture refused/)
    assert.equal(count, 1)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('CLI refuses real checked-in unlicensed M1 gate without writing a capture directory', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'supa-unlicensed-cli-'))
  try {
    const output = join(temp, 'never-written')
    const run = spawnSync(process.execPath, [
      '--experimental-strip-types',
      new URL('../scripts/retailer-authorized-html-capture.mjs', import.meta.url).pathname,
      '--source', plus.id, '--out', output,
    ], { encoding: 'utf8', timeout: 15000 })
    assert.notEqual(run.status, 0)
    await assert.rejects(stat(output), { code: 'ENOENT' })
    assert.doesNotMatch(run.stderr, /Fictional shop|1\.99/)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
