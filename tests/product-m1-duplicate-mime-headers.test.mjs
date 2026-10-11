import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

function response(...headers) {
  return ['HTTP/1.1 200 Synthetic', ...headers, '', ''].join('\r\n')
}

test('a unique MIME header and final response after CONNECT remain accepted', () => {
  assert.deepEqual(parseCaptureHeaders(response('Content-Type: text/html; charset=utf8')),
    { status: 200, contentType: 'text/html' })
  assert.deepEqual(parseCaptureHeaders(response('CONTENT-TYPE: APPLICATION/XHTML+XML')),
    { status: 200, contentType: 'application/xhtml+xml' })
  const prelim = ['HTTP/1.1 200 Connection established', '', '',
    response('Content-Type: text/html')].join('\r\n')
  assert.deepEqual(parseCaptureHeaders(prelim), { status: 200, contentType: 'text/html' })
})

test('duplicate Content-Type is rejected even if identical, mixed-case or conflicting', () => {
  const headers = [
    ['Content-Type: text/html', 'content-type: application/json'],
    ['Content-Type: text/html', 'Content-Type: text/html'],
    ['CONTENT-TYPE: application/json', 'cOnTeNt-TyPe: text/html'],
  ]
  for (const values of headers) {
    assert.throws(() => parseCaptureHeaders(response(...values)), /ambiguous.*content.type/i)
  }
})

async function fakeCurl(directory, headerLines) {
  const bin = join(directory, 'bin')
  await mkdir(bin, { recursive: true })
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
    "printf '%s\\r\\n' 'HTTP/1.1 200 Synthetic' " +
      headerLines.map(line => "'" + line + "'").join(' ') + " '' > \"$header\"",
    "printf '<html>fixture only</html>' > \"$body\"",
    "printf '200'",
    '',
  ].join('\n')
  const curl = join(bin, 'curl')
  await writeFile(curl, script, { mode: 0o700 })
  await chmod(curl, 0o700)
  return bin
}

test('ambiguous synthetic fake-curl HTTP200 never creates a saved research snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-mime-gate-'))
  try {
    const dir = join(root, 'saved')
    const bin = await fakeCurl(root,
      ['Content-Type: text/html', 'content-type: application/json'])
    const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
    await assert.rejects(captureResearchSource('dirk-halvarine',
      { env, outputDir: dir }), /ambiguous.*content.type/i)
    await assert.rejects(stat(dir), { code: 'ENOENT' })
    // Same controlled fixture endpoint, now unequivocal HTML.
    await fakeCurl(root, ['Content-Type: text/html'])
    const saved = await captureResearchSource('dirk-halvarine', { env, outputDir: dir })
    assert.equal(saved.status, 'saved')
    assert.equal((await stat(saved.html)).mode & 0o777, 0o600)
    const metadata = JSON.parse(await readFile(saved.meta, 'utf8'))
    assert.equal(metadata.mediaType, 'text/html')
    assert.equal(metadata.type, 'research-only-not-price-proof')
    assert.equal(metadata.proxyMode, 'direct')
    assert.equal((await stat(join(dir, 'dirk-halvarine'))).mode & 0o777, 0o700)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
