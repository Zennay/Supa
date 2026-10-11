import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, parseCaptureHeaders } from '../scripts/m1-multistore-research.mjs'

// Synthetic only. Never touch retailer endpoints: PATH resolves curl to this
// local fixture, and the source permission opt-in is only in the stub env.
test('M1 HTTP version/status separator refuses non-HTTP Unicode and control whitespace (#1312)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-status-separator-'))
  try {
    const bin = join(root, 'bin')
    const headersFile = join(root, 'response-headers')
    const calls = join(root, 'fake-curl-calls')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'header=""',
      'body=""',
      'writeout=0',
      'noproxy=0',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --write-out) test "$2" = "%{http_code}" || exit 91; writeout=1; shift 2 ;;',
      '    --noproxy) test "$2" = "*" || exit 92; noproxy=1; shift 2 ;;',
      '    --retry|--location|--compressed|--proxy) exit 93 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$writeout" = 1 && test "$noproxy" = 1',
      'test -n "$header" && test -n "$body"',
      'cat ' + JSON.stringify(headersFile) + ' > "$header"',
      'printf "<html>OFFLINE_SEPARATOR_ONLY</html>" > "$body"',
      'printf "called\n" >> ' + JSON.stringify(calls),
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)

    const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
    const scenarios = [
      { id: 'canonical-http11', line: 'HTTP/1.1 200 OK', valid: true },
      { id: 'canonical-http2', line: 'HTTP/2 200', valid: true },
      { id: 'nonbreaking-space', line: 'HTTP/1.1\u00a0200 OK', valid: false },
      { id: 'vertical-tab', line: 'HTTP/1.1\u000b200 OK', valid: false },
      { id: 'form-feed', line: 'HTTP/2\u000c200', valid: false },
      { id: 'em-space', line: 'HTTP/3\u2003200', valid: false },
    ]

    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.id, async () => {
        const responseHeaders = scenario.line + '\r\nContent-Type: text/html\r\nContent-Encoding: identity\r\n\r\n'
        await writeFile(headersFile, responseHeaders)
        const out = join(root, 'output-' + scenario.id)
        const run = () => captureResearchSource('dirk-boodschappen', { env, outputDir: out })
        if (scenario.valid) {
          assert.equal(parseCaptureHeaders(responseHeaders).status, 200)
          const saved = await run()
          assert.equal(saved.status, 'saved')
          assert.equal(await readFile(saved.html, 'utf8'), '<html>OFFLINE_SEPARATOR_ONLY</html>')
          const meta = JSON.parse(await readFile(saved.meta, 'utf8'))
          assert.equal(meta.type, 'research-only-not-price-proof')
          assert.equal(meta.httpStatus, 200)
          assert.equal(meta.proxyMode, 'direct')
          assert.equal((await stat(saved.html)).mode & 0o077, 0)
          assert.equal((await stat(saved.meta)).mode & 0o077, 0)
        } else {
          // Do not archive an invalid final HTTP response even when fake curl
          // reports status 200 and a regular HTML Content-Type.
          await assert.rejects(run, /unrecognized HTTP response headers/)
          assert.throws(() => parseCaptureHeaders(responseHeaders), /unrecognized HTTP response headers/)
          await assert.rejects(readdir(out), { code: 'ENOENT' })
        }
        assert.equal(await readFile(calls, 'utf8'), 'called\n'.repeat(index + 1),
          'one fake curl invocation per scenario, no retry or fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
