import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Independent postrepair integration: every call is a local fake-curl invocation.
// HTTPS_PROXY is checked as an environment variable, but no proxy socket opens.
test('M1 fixed-proxy final curl status cannot contradict archived HTTP provenance', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-curl-status-proxy-'))
  try {
    const bin = join(root, 'bin')
    const rawHeaders = join(root, 'headers')
    const statusFile = join(root, 'curl-status')
    const calls = join(root, 'calls')
    await mkdir(bin)
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'test "$HTTPS_PROXY" = "http://127.0.0.1:8943/"',
      "headers=''",
      "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) headers="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --noproxy|--compressed|--location|--retry) exit 91 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test -n "$headers" && test -n "$body"',
      'cat ' + JSON.stringify(rawHeaders) + ' > "$headers"',
      'printf "<html>PRIVATE_PROXY_STATUS_SENTINEL</html>" > "$body"',
      'printf "called\\n" >> ' + JSON.stringify(calls),
      'cat ' + JSON.stringify(statusFile),
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const body = '<html>PRIVATE_PROXY_STATUS_SENTINEL</html>'
    const sha256 = createHash('sha256').update(body).digest('hex')
    const env = {
      PATH: bin + ':/usr/bin:/bin',
      SUPA_RESEARCH_APPROVED: '1',
      SUPA_RESEARCH_PROXY_URL: 'http://127.0.0.1:8943',
    }
    const scenarios = [
      { name: 'consistent-final-200', headers: 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n', status: '200', valid: true },
      { name: 'contradictory-201', headers: 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n', status: '201' },
      { name: 'transport-000', headers: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n', status: '000' },
      { name: 'trailing-newline', headers: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n', status: '200\n' },
      { name: 'denied-403', headers: 'HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\n', status: '403', denied: true },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.name, async () => {
        await writeFile(rawHeaders, scenario.headers)
        await writeFile(statusFile, scenario.status)
        const outputDir = join(root, 'out-' + scenario.name)
        const capture = () => captureResearchSource('dirk-boodschappen', { env, outputDir })
        if (scenario.valid) {
          const result = await capture()
          const metadata = JSON.parse(await readFile(result.meta, 'utf8'))
          assert.equal(result.status, 'saved')
          assert.equal(metadata.proxyMode, 'approved-fixed-egress')
          assert.equal(metadata.httpStatus, 200)
          assert.equal(metadata.type, 'research-only-not-price-proof')
          assert.equal(metadata.sha256, sha256)
          assert.equal(await readFile(result.html, 'utf8'), body)
          assert.equal((await stat(result.html)).mode & 0o077, 0)
          assert.equal((await stat(result.meta)).mode & 0o077, 0)
        } else {
          await assert.rejects(capture, error => {
            assert.match(error.message, scenario.denied ? /HTTP 403.*without retry/ : /curl final HTTP status/)
            assert.doesNotMatch(error.message, /PRIVATE_PROXY_STATUS_SENTINEL/)
            return true
          }, scenario.name)
          await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
        }
        assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, index + 1,
          'one fake curl only, without fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
