import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Entirely synthetic local fake-curl: no supermarket, proxy or network requests.
// The final HTTP200 status and valid HTML body isolate malformed field-name syntax.
test('M1 private capture must reject malformed HTTP header field names before archiving', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-header-name-qa-'))
  try {
    const bin = join(root, 'bin')
    const rawHeaders = join(root, 'response-headers')
    const calls = join(root, 'curl-calls')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'headers=""',
      'body=""',
      'noproxy=0',
      'writeout=0',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) headers="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --noproxy) test "$2" = "*" || exit 91; noproxy=1; shift 2 ;;',
      '    --write-out) test "$2" = "%{http_code}" || exit 92; writeout=1; shift 2 ;;',
      '    --proxy|--retry|--location|--compressed) exit 93 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$noproxy" = 1 && test "$writeout" = 1',
      'test -n "$headers" && test -n "$body"',
      'cat ' + JSON.stringify(rawHeaders) + ' > "$headers"',
      'printf "<html>QA_ONLY_HEADER_SENTINEL</html>" > "$body"',
      'printf "called\n" >> ' + JSON.stringify(calls),
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
    const scenarios = [
      { name: 'canonical-field-names', header: 'Content-Type: text/html\r\nX-QA-Trace: safe\r\nContent-Encoding: identity', valid: true },
      { name: 'space-before-content-type-colon', header: 'Content-Type : text/html' },
      { name: 'tab-before-content-type-colon', header: 'Content-Type\t: text/html' },
      { name: 'space-before-content-encoding-colon', header: 'Content-Type: text/html\r\nContent-Encoding : identity' },
      { name: 'space-before-custom-field-colon', header: 'Content-Type: text/html\r\nX-QA-Trace : safe' },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.name, async () => {
        await writeFile(rawHeaders, 'HTTP/1.1 200 OK\r\n' + scenario.header + '\r\n\r\n')
        const outputDir = join(root, 'output-' + scenario.name)
        const capture = () => captureResearchSource('dirk-boodschappen', { env, outputDir })
        if (scenario.valid) {
          const result = await capture()
          assert.equal(result.status, 'saved')
          const metadata = JSON.parse(await readFile(result.meta, 'utf8'))
          assert.equal(metadata.httpStatus, 200)
          assert.equal(metadata.mediaType, 'text/html')
          assert.equal(metadata.type, 'research-only-not-price-proof')
          assert.equal(await readFile(result.html, 'utf8'), '<html>QA_ONLY_HEADER_SENTINEL</html>')
          assert.equal((await stat(result.html)).mode & 0o077, 0)
          assert.equal((await stat(result.meta)).mode & 0o077, 0)
        } else {
          await assert.rejects(capture, /malformed response header name/)
          await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
        }
        assert.equal(await readFile(calls, 'utf8'), 'called\n'.repeat(index + 1),
          'only one local fake curl per scenario; never retry or fall back')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
