import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

const MAX_HEADERS = 64 * 1024
const prefix = 'HTTP/1.1 200 Fixture\r\nContent-Type: text/html\r\nX-Filler: '
const suffix = '\r\n\r\n'

test('response parser permits exactly 64 KiB of raw headers and rejects one extra byte', () => {
  const accepted = prefix + 'a'.repeat(MAX_HEADERS - Buffer.byteLength(prefix + suffix)) + suffix
  assert.equal(Buffer.byteLength(accepted), MAX_HEADERS)
  assert.deepEqual(parseCaptureHeaders(accepted), { status: 200, contentType: 'text/html' })
  assert.throws(() => parseCaptureHeaders(prefix +
    'a'.repeat(MAX_HEADERS + 1 - Buffer.byteLength(prefix + suffix)) + suffix),
  /header.*(budget|large|exceed)/i)
})

test('UTF-8 multibyte header budget counts raw bytes rather than JavaScript characters', () => {
  const raw = prefix + '€'.repeat(22_000) + suffix
  assert.ok(raw.length < MAX_HEADERS)
  assert.ok(Buffer.byteLength(raw) > MAX_HEADERS)
  assert.throws(() => parseCaptureHeaders(raw), /header.*(budget|large|exceed)/i)
})

test('large fake-curl HTTP 200 headers never create a private research capture or retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-header-cap-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin, { mode: 0o700 })
    const script = [
      '#!/bin/sh', "header=''", "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      "printf 'HTTP/1.1 200 Fixture\\r\\nContent-Type: text/html\\r\\nX-Filler: ' > \"$header\"",
      "head -c 70000 /dev/zero | tr '\\000' 'a' >> \"$header\"",
      "printf '\\r\\n\\r\\n' >> \"$header\"",
      "printf '<html>synthetic only</html>' > \"$body\"",
      "printf '200'",
      '',
    ].join('\n')
    const fake = join(bin, 'curl')
    await writeFile(fake, script, { mode: 0o700 })
    await chmod(fake, 0o700)
    const outputDir = join(root, 'private')
    await assert.rejects(captureResearchSource('dirk-halvarine', {
      outputDir, env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
    }), /header.*(budget|large|exceed)/i)
    await assert.rejects(stat(outputDir), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
