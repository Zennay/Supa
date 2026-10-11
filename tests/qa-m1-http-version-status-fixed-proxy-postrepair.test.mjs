import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

// Independent postrepair QA on the approved *fixed-proxy* route. The proxy
// never opens a socket: its environment string is inspected by local fake curl.
test('M1 fixed-proxy final response only trusts ASCII version/status delimiters (#1312)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-status-proxy-postrepair-'))
  try {
    const bin = join(root, 'bin')
    const fixture = join(root, 'headers-fixture')
    const calls = join(root, 'local-calls')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'test "$HTTPS_PROXY" = "http://127.0.0.1:8943/"',
      'header=""',
      'body=""',
      'writeout=0',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --write-out) test "$2" = "%{http_code}" || exit 91; writeout=1; shift 2 ;;',
      '    --noproxy|--proxy|--retry|--location|--compressed) exit 92 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$writeout" = 1 && test -n "$header" && test -n "$body"',
      'cat ' + JSON.stringify(fixture) + ' > "$header"',
      'printf "<html>FIXED_PROXY_OFFLINE_QA</html>" > "$body"',
      'printf "called\n" >> ' + JSON.stringify(calls),
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
      { id: 'ordinary-http11', line: 'HTTP/1.1 200 OK', valid: true },
      { id: 'ordinary-http2', line: 'HTTP/2 200', valid: true },
      { id: 'ascii-tab', line: 'HTTP/1.1\t200 OK', valid: true },
      { id: 'nonbreaking-space', line: 'HTTP/1.1\u00a0200 OK' },
      { id: 'vertical-tab', line: 'HTTP/1.1\u000b200 OK' },
      { id: 'form-feed', line: 'HTTP/2\u000c200' },
      { id: 'em-space', line: 'HTTP/3\u2003200' },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.id, async () => {
        // A preliminary HTTP100 must not mask syntax errors in the *final* block.
        const headers = 'HTTP/1.1 100 Continue\r\n\r\n' +
          scenario.line + '\r\nContent-Type: text/html\r\nContent-Encoding: identity\r\n\r\n'
        await writeFile(fixture, headers)
        const outputDir = join(root, scenario.id)
        const run = () => captureResearchSource('hoogvliet-magere-melk', { env, outputDir })
        if (scenario.valid) {
          assert.equal(parseCaptureHeaders(headers).status, 200)
          const saved = await run()
          const meta = JSON.parse(await readFile(saved.meta, 'utf8'))
          assert.equal(saved.status, 'saved')
          assert.equal(meta.sourceId, 'hoogvliet-magere-melk')
          assert.equal(meta.httpStatus, 200)
          assert.equal(meta.proxyMode, 'approved-fixed-egress')
          assert.equal(meta.type, 'research-only-not-price-proof')
          assert.equal(await readFile(saved.html, 'utf8'), '<html>FIXED_PROXY_OFFLINE_QA</html>')
          assert.equal((await stat(saved.html)).mode & 0o077, 0)
          assert.equal((await stat(saved.meta)).mode & 0o077, 0)
        } else {
          assert.throws(() => parseCaptureHeaders(headers), /unrecognized HTTP response headers/)
          await assert.rejects(run, /unrecognized HTTP response headers/)
          await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
        }
        assert.equal(await readFile(calls, 'utf8'), 'called\n'.repeat(index + 1),
          'only one local stub call per fixed-proxy test, without fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
