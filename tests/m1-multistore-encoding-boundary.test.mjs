import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

const header = (encoding = '') =>
  'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n' + encoding + '\r\n'

test('M1 HTML capture rejects unsupported encodings before archiving', () => {
  assert.deepEqual(parseCaptureHeaders(header()), {
    status: 200,
    contentType: 'text/html',
  })
  assert.deepEqual(parseCaptureHeaders(header('Content-Encoding: identity\r\n')), {
    status: 200,
    contentType: 'text/html',
  })
  for (const encoding of ['gzip', 'br', 'deflate', 'compress', 'gzip, identity', '']) {
    assert.throws(
      () => parseCaptureHeaders(header('Content-Encoding: ' + encoding + '\r\n')),
      /content-encoding/,
      encoding || 'empty encoding',
    )
  }
})

test('duplicate Content-Encoding is rejected, including identical identity headers', () => {
  for (const second of ['identity', 'gzip']) {
    assert.throws(
      () => parseCaptureHeaders(header(
        'Content-Encoding: identity\r\nContent-Encoding: ' + second + '\r\n',
      )),
      /content-encoding/,
    )
  }
})

test('compressed synthetic HTTP200 does not create an HTML capture pair', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m1-encoding-'))
  try {
    const bin = join(dir, 'bin')
    await mkdir(bin)
    const curl = join(bin, 'curl')
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
      "printf 'HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nContent-Encoding: gzip\\r\\n\\r\\n' > \"$header\"",
      "printf 'not decoded HTML' > \"$body\"",
      "printf '200'",
      '',
    ].join('\n')
    await writeFile(curl, script)
    await chmod(curl, 0o700)
    const outputDir = join(dir, 'captures')
    await assert.rejects(
      captureResearchSource('dirk-boodschappen', {
        outputDir,
        env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
      }),
      /content-encoding/,
    )
    await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
