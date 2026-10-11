import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

// Postrepair, no live retailer requests: all HTTP blocks are local fake-curl bytes.
const interim = 'HTTP/1.1 100 Continue\r\n\r\n'
const ok = 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n'
const complete = (tail = '') => interim + ok + tail + '\r\n'

test('M1 postrepair accepts a clean final 200 after an informational block', () => {
  assert.deepEqual(parseCaptureHeaders(complete('Content-Encoding: identity\r\n')), {
    status: 200,
    contentType: 'text/html',
  })
  assert.deepEqual(parseCaptureHeaders(complete()), {
    status: 200,
    contentType: 'text/html',
  })
})

test('M1 postrepair rejects malformed final-block fields even after a valid 100', () => {
  for (const malformed of [
    'X-Orphan-Header\r\n',
    'Content-Encoding: identity\r\n  gzip\r\n',
    '\tContent-Encoding: identity\r\n',
    'Content-Type: text/html\r\nOrphan-Continuation\r\n',
  ]) {
    assert.throws(
      () => parseCaptureHeaders(complete(malformed)),
      /header|malformed|ambiguous/i,
      'malformed final block ' + JSON.stringify(malformed),
    )
  }
})

test('M1 fake-curl response chain archives only a clean final HTML response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-response-chain-qa-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const headerFixture = join(root, 'fixture-headers')
    const bodyFixture = join(root, 'fixture-body')
    const calls = join(root, 'calls')
    await writeFile(bodyFixture, '<html>PRIVATE_CHAIN_SENTINEL</html>')
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      "header=''",
      "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --compressed|--location|--retry) exit 91 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'cat ' + JSON.stringify(headerFixture) + ' > "$header"',
      'cat ' + JSON.stringify(bodyFixture) + ' > "$body"',
      'printf "called\\n" >> ' + JSON.stringify(calls),
      "printf '200'",
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
    const cases = [
      { name: 'clean', raw: complete('Content-Encoding: identity\r\n'), valid: true },
      { name: 'orphan', raw: complete('X-Orphan-Header\r\n'), valid: false },
      { name: 'folded', raw: complete('Content-Encoding: identity\r\n\tgzip\r\n'), valid: false },
      { name: 'status-302', raw: 'HTTP/1.1 302 Found\r\nLocation: https://www.dirk.nl/boodschappen\r\n\r\n', valid: false, status: true },
    ]
    let n = 0
    for (const item of cases) {
      await writeFile(headerFixture, item.raw)
      const outputDir = join(root, item.name)
      const capture = () => captureResearchSource('dirk-boodschappen', { env, outputDir })
      if (item.valid) {
        const saved = await capture()
        const metadata = JSON.parse(await readFile(saved.meta, 'utf8'))
        assert.equal(saved.status, 'saved')
        assert.equal(metadata.type, 'research-only-not-price-proof')
        assert.equal(metadata.httpStatus, 200)
        assert.equal(metadata.mediaType, 'text/html')
        assert.equal(await readFile(saved.html, 'utf8'), '<html>PRIVATE_CHAIN_SENTINEL</html>')
        assert.equal((await stat(saved.html)).mode & 0o077, 0)
        assert.equal((await stat(saved.meta)).mode & 0o077, 0)
      } else {
        await assert.rejects(capture, error => {
          assert.match(error.message, item.status ? /HTTP 302/ : /header|ambiguous|malformed/i)
          assert.doesNotMatch(error.message, /PRIVATE_CHAIN_SENTINEL/)
          return true
        }, item.name)
        await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
      }
      n += 1
      assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, n,
        'exactly one local fake invocation and no retry')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
