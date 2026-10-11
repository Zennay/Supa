import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Postrepair quality acceptance: approved fixed-proxy path is simulated by a
// local fake curl. No socket, retailer, live HTML, price or source authorization.
test('M1 raw HTTP field-name token policy preserves valid extension fields and refuses invalid bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-postrepair-header-token-'))
  try {
    const bin = join(root, 'bin')
    const headersFile = join(root, 'headers-fixture')
    const callFile = join(root, 'fake-curl-calls')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'test "$HTTPS_PROXY" = "http://127.0.0.1:8943/"',
      'headers=""',
      'body=""',
      'writeout=0',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) headers="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --write-out) test "$2" = "%{http_code}" || exit 91; writeout=1; shift 2 ;;',
      '    --noproxy|--location|--retry|--compressed|--proxy) exit 92 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$writeout" = 1 && test -n "$headers" && test -n "$body"',
      'cat ' + JSON.stringify(headersFile) + ' > "$headers"',
      'printf "<html>QA_ONLY_TOKEN_PROOF</html>" > "$body"',
      'printf "called\n" >> ' + JSON.stringify(callFile),
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const env = {
      PATH: bin + ':/usr/bin:/bin',
      SUPA_RESEARCH_APPROVED: '1',
      SUPA_RESEARCH_PROXY_URL: 'http://127.0.0.1:8943',
    }
    const scenarios = [
      { name: 'ordinary-valid-field', field: 'X-QA-Trace: yes', valid: true },
      { name: 'punctuation-token-valid', field: "X!#$%&'*+.^_" + String.fromCharCode(96) + '|~-Trace: yes', valid: true },
      { name: 'at-sign-invalid', field: 'X-QA@Trace: no' },
      { name: 'parentheses-invalid', field: 'X-QA(Trace): no' },
      { name: 'slash-invalid', field: 'X-QA/Trace: no' },
      { name: 'nonascii-invalid', field: 'X-QA-\u00e9: no' },
      { name: 'nul-control-invalid', field: 'X-QA\u0000Trace: no' },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.name, async () => {
        await writeFile(headersFile,
          'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\ncontent-type: text/html\r\n' + scenario.field + '\r\n\r\n')
        const outputDir = join(root, 'out-' + scenario.name)
        const capture = () => captureResearchSource('dirk-boodschappen', { env, outputDir })
        if (scenario.valid) {
          const result = await capture()
          assert.equal(result.status, 'saved')
          assert.equal(await readFile(result.html, 'utf8'), '<html>QA_ONLY_TOKEN_PROOF</html>')
          const metadata = JSON.parse(await readFile(result.meta, 'utf8'))
          assert.equal(metadata.httpStatus, 200)
          assert.equal(metadata.proxyMode, 'approved-fixed-egress')
          assert.equal(metadata.type, 'research-only-not-price-proof')
          assert.equal((await stat(result.html)).mode & 0o077, 0)
          assert.equal((await stat(result.meta)).mode & 0o077, 0)
        } else {
          await assert.rejects(capture, /malformed response header name/)
          await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
        }
        assert.equal(await readFile(callFile, 'utf8'), 'called\n'.repeat(index + 1),
          'one local fake curl only, no retry or unapproved proxy fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
