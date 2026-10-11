import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

const response = headers => 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n' + headers + '\r\n'

test('M1 private parser still accepts a single ordinary identity coding', () => {
  assert.deepEqual(parseCaptureHeaders(response('Content-Encoding: identity\r\n')), {
    status: 200,
    contentType: 'text/html',
  })
})

test('M1 private parser must reject folded Content-Encoding values', () => {
  for (const continuation of [' gzip', '\t,gzip', ' identity']) {
    assert.throws(
      () => parseCaptureHeaders(response('Content-Encoding: identity\r\n' + continuation + '\r\n')),
      /header|encoding|fold|malformed|ambiguous/i,
      'folded continuation ' + JSON.stringify(continuation) + ' must not be discarded',
    )
  }
})

test('M1 private parser must reject disguised encoding folded after Content-Type', () => {
  assert.throws(
    () => parseCaptureHeaders('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n Content-Encoding: gzip\r\n\r\n'),
    /header|encoding|fold|malformed|ambiguous/i,
  )
})

test('M1 fake-curl ambiguous folded HTTP200 cannot leave a private HTML snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-folded-qa-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const curl = [
      '#!/bin/sh',
      'set -eu',
      "header=''",
      "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      "printf 'HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nContent-Encoding: identity\\r\\n gzip\\r\\n\\r\\n' > \"$header\"",
      "printf '<html>PRIVATE_FOLDED_BODY_SENTINEL</html>' > \"$body\"",
      "printf '200'",
      '',
    ].join('\n')
    await writeFile(join(bin, 'curl'), curl)
    await chmod(join(bin, 'curl'), 0o700)
    const outputDir = join(root, 'captures')
    await assert.rejects(
      captureResearchSource('dirk-boodschappen', {
        outputDir,
        env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
      }),
      /header|encoding|fold|malformed|ambiguous/i,
    )
    await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
