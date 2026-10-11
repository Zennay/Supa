import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Independent disk-level integration proof for #1265. Fake curl never contacts a retailer.
const HEADER_LIMIT = 64 * 1024
const prefix = 'HTTP/1.1 200 Synthetic\r\nContent-Type: text/html\r\nX-Fixture: '
const suffix = '\r\n\r\n'

async function fakeCurlWithHeaders(root, totalHeaderBytes) {
  const bin = join(root, 'bin')
  await mkdir(bin, { mode: 0o700 })
  const calls = join(root, 'calls.txt')
  const paddingBytes = totalHeaderBytes - Buffer.byteLength(prefix + suffix)
  assert.ok(paddingBytes >= 0)
  const script = [
    '#!/bin/sh',
    "printf 'x\\n' >> '" + calls + "'",
    "header=''",
    "body=''",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    --dump-header) header="$2"; shift 2 ;;',
    '    --output) body="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    "printf 'HTTP/1.1 200 Synthetic\\r\\nContent-Type: text/html\\r\\nX-Fixture: ' > \"$header\"",
    'head -c ' + paddingBytes + ' /dev/zero | tr \'\\000\' \'a\' >> "$header"',
    "printf '\\r\\n\\r\\n' >> \"$header\"",
    "printf '<html>local fixture only</html>' > \"$body\"",
    "printf '200'",
    '',
  ].join('\n')
  const curl = join(bin, 'curl')
  await writeFile(curl, script, { mode: 0o700 })
  await chmod(curl, 0o700)
  return { calls, env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' } }
}

test('fake-curl disk headers at exactly 64 KiB allow owner-private non-evidence snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-capture-headers-edge-'))
  try {
    const { calls, env } = await fakeCurlWithHeaders(root, HEADER_LIMIT)
    const outputDir = join(root, 'private-captures')
    const result = await captureResearchSource('dirk-halvarine', { outputDir, env })
    assert.equal(result.status, 'saved')
    assert.equal(result.sourceId, 'dirk-halvarine')
    assert.equal((await stat(outputDir)).mode & 0o777, 0o700)
    assert.equal((await stat(join(outputDir, 'dirk-halvarine'))).mode & 0o777, 0o700)
    assert.equal((await stat(result.html)).mode & 0o777, 0o600)
    assert.equal((await stat(result.meta)).mode & 0o777, 0o600)
    assert.equal((await readFile(calls, 'utf8')).trim(), 'x')
    const metadata = JSON.parse(await readFile(result.meta, 'utf8'))
    assert.equal(metadata.mediaType, 'text/html')
    assert.equal(metadata.type, 'research-only-not-price-proof')
    assert.equal(metadata.httpStatus, 200)
    assert.equal(metadata.proxyMode, 'direct')
    assert.match(await readFile(result.html, 'utf8'), /local fixture only/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fake-curl disk headers at 64 KiB + 1 abort before saved snapshot without retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-capture-headers-edge-'))
  try {
    const { calls, env } = await fakeCurlWithHeaders(root, HEADER_LIMIT + 1)
    const outputDir = join(root, 'private-captures')
    await assert.rejects(
      captureResearchSource('dirk-halvarine', { outputDir, env }),
      error => error instanceof Error && /response headers exceed byte budget/.test(error.message) &&
        !/X-Fixture|local fixture/.test(error.message),
    )
    await assert.rejects(stat(outputDir), { code: 'ENOENT' })
    assert.equal((await readFile(calls, 'utf8')).trim(), 'x')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
