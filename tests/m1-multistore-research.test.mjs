import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { RESEARCH_SOURCES, validateResearchSource, researchTransport,
  parseCaptureHeaders, main, captureResearchSource } from '../scripts/m1-multistore-research.mjs'

test('four stores with five real-public-page research probes and strict host validation', () => {
  assert.deepEqual(RESEARCH_SOURCES.map(x => x.store), ['ah', 'dirk', 'dirk', 'hoogvliet', 'jumbo'])
  for (const source of RESEARCH_SOURCES) assert.equal(validateResearchSource(source), true)
  for (const url of [
    'http://www.ah.nl/producten/product/wi1525/halfvolle-melk',
    'https://www.ah.nl.evil.tld/anything',
    'https://user:pass@www.ah.nl/product',
    'https://www.dirk.nl/boodschappen',
  ]) assert.throws(() => validateResearchSource({ ...RESEARCH_SOURCES[0], url }))
  assert.throws(() => validateResearchSource({ ...RESEARCH_SOURCES[0], kind: 'account' }))
  assert.throws(() => validateResearchSource(null))
})

test('proxy requires explicit opt-in and rejects credentials or rotational transports', () => {
  assert.deepEqual(researchTransport({}), { approved: false, proxy: null })
  assert.throws(() => researchTransport({ SUPA_RESEARCH_PROXY_URL: 'http://localhost:3128' }), /approved/)
  assert.deepEqual(researchTransport({ SUPA_RESEARCH_APPROVED: '1',
    SUPA_RESEARCH_PROXY_URL: 'http://127.0.0.1:3128' }),
    { approved: true, proxy: 'http://127.0.0.1:3128/' })
  for (const url of ['socks5://localhost:1080', 'http://a:b@localhost:3128',
    'https://localhost:3128/route', 'invalid', 'http://localhost:3128/?x=1']) {
    assert.throws(() => researchTransport({ SUPA_RESEARCH_APPROVED: '1', SUPA_RESEARCH_PROXY_URL: url }))
  }
})

test('parse headers safely after CONNECT prelude and recognize refusal', () => {
  assert.deepEqual(parseCaptureHeaders('HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 403\r\nContent-Type: text/html; charset=utf8\r\n\r\n'),
    { status: 403, contentType: 'text/html' })
  assert.deepEqual(parseCaptureHeaders('HTTP/1.1 200 OK\r\nContent-Type: TEXT/HTML; charset=utf8\r\n\r\n'),
    { status: 200, contentType: 'text/html' })
  assert.throws(() => parseCaptureHeaders('junk'))
})

test('read-only --list does not fetch, CLI capture refuses without approval', async () => {
  const out = []
  assert.equal(await main(['--list'], {}, value => out.push(value)), 0)
  assert.equal(JSON.parse(out[0]).length, 5)
  await assert.rejects(captureResearchSource('ah-halfvolle-melk', { env: {} }), /SUPA_RESEARCH_APPROVED/)
  await assert.rejects(captureResearchSource('missing', { env: { SUPA_RESEARCH_APPROVED: '1' } }), /unknown/)
  const cli = spawnSync(process.execPath, [resolve('scripts/m1-multistore-research.mjs'),
    '--capture', 'ah-halfvolle-melk'], { env: { PATH: process.env.PATH }, encoding: 'utf8' })
  assert.equal(cli.status, 1)
  assert.match(cli.stderr, /SUPA_RESEARCH_APPROVED=1/)
})

test('browser DOM probe only emits selectors actually found, never content or price values', () => {
  const snippet = readFileSync(resolve('scripts/m1-dom-candidate-probe.js'), 'utf8')
  const fakeDoc = { querySelectorAll(selector) {
    if (selector === 'h1') return [{ tagName: 'H1', classList: ['title'], textContent: 'secret content' }]
    if (selector === '[class*="price" i]') return [{ tagName: 'SPAN', classList: ['price-main'], textContent: '€999' }]
    if (selector.startsWith('h1,')) return [
      { tagName: 'H1', classList: ['title'], textContent: 'secret content' },
      { tagName: 'SPAN', classList: ['price-main'], textContent: '€999' },
    ]
    return []
  } }
  const logs = []
  const context = { document: fakeDoc, location: { hostname: 'www.dirk.nl', protocol: 'https:' },
    Date, console: { log: (...args) => logs.push(args) } }
  context.globalThis = context
  const report = vm.runInNewContext(snippet, context)
  assert.equal(report.selectors.length, 2)
  assert.equal(report.actualClassCandidates.some(x => x.selector === 'span.price-main'), true)
  assert.doesNotMatch(JSON.stringify(report), /secret content|999/)
  assert.equal(logs.length, 1)
  context.location.hostname = 'attacker.invalid'
  assert.throws(() => vm.runInNewContext(snippet, context), /approved/)
})

async function fakeCurl(dir, status) {
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const script = [
    '#!/bin/sh',
    "header=''",
    "body=''",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --dump-header) header="$2"; shift 2 ;;',
    '    --output) body="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    "printf 'HTTP/1.1 " + status + " Synthetic\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$header\"",
    "printf '<html>synthetic fixture only</html>' > \"$body\"",
    "printf '" + status + "'",
    '',
  ].join('\n')
  const filename = join(bin, 'curl')
  await writeFile(filename, script)
  await chmod(filename, 0o700)
  return bin
}

test('mock HTTP200 creates a private hashed snapshot labeled non-evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-multistore-test-'))
  try {
    const bin = await fakeCurl(dir, 200)
    const result = await captureResearchSource('dirk-boodschappen', {
      outputDir: join(dir, 'out'),
      env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
    })
    assert.equal(result.status, 'saved')
    const meta = JSON.parse(await readFile(result.meta, 'utf8'))
    assert.equal(meta.httpStatus, 200)
    assert.equal(meta.type, 'research-only-not-price-proof')
    assert.equal(meta.proxyMode, 'direct')
    assert.equal(meta.sha256, result.sha256)
    assert.match(await readFile(result.html, 'utf8'), /synthetic fixture/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('mock HTTP403 stops capture instead of switching proxy or accepting evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-multistore-test-'))
  try {
    const bin = await fakeCurl(dir, 403)
    await assert.rejects(captureResearchSource('ah-halfvolle-melk', {
      outputDir: join(dir, 'out'),
      env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
    }), /HTTP 403.*without retry/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('single approved proxy route records mode only, and denied proxy request still fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-fixed-proxy-test-'))
  try {
    const proxyUrl = 'http://127.0.0.1:3128'
    const approvedEnv = { SUPA_RESEARCH_APPROVED: '1', SUPA_RESEARCH_PROXY_URL: proxyUrl }
    const okBin = await fakeCurl(dir, 200)
    const accepted = await captureResearchSource('hoogvliet-magere-melk', {
      env: { ...approvedEnv, PATH: okBin + ':/usr/bin:/bin' },
      outputDir: join(dir, 'out'),
    })
    const meta = JSON.parse(await readFile(accepted.meta, 'utf8'))
    assert.equal(meta.proxyMode, 'approved-fixed-egress')
    assert.doesNotMatch(JSON.stringify(meta), /127\.0\.0\.1|3128|proxyUrl/)
    // A refusal remains terminal even if a proxy was explicitly configured.
    await rm(join(dir, 'bin', 'curl'))
    const deniedBody = [
      '#!/bin/sh', "header=''", "body=''",
      'while [ "$#" -gt 0 ]; do',
      ' case "$1" in --dump-header) header="$2"; shift 2 ;; --output) body="$2"; shift 2 ;; *) shift ;; esac',
      'done',
      "printf 'HTTP/1.1 403 Denied\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$header\"",
      "printf 'access denied' > \"$body\"",
      '',
    ].join('\n')
    const deniedCurl = join(dir, 'bin', 'curl')
    await writeFile(deniedCurl, deniedBody)
    await chmod(deniedCurl, 0o700)
    await assert.rejects(captureResearchSource('hoogvliet-magere-melk', {
      env: { ...approvedEnv, PATH: okBin + ':/usr/bin:/bin' },
      outputDir: join(dir, 'rejected'),
    }), /HTTP 403.*without retry/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
