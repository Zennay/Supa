import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Synthetic-only QA: curl is a local shell stub and cannot contact retailers.
// Status-line syntax must be checked before private HTML/metadata is archived.
test('M1 final HTTP status code must be delimited rather than followed by garbage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-http-status-delimiter-'))
  try {
    const bin = join(root, 'bin')
    const headersFile = join(root, 'headers')
    const calls = join(root, 'fake-curl-count')
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
      'printf "<html>QA_STATUS_LINE_SENTINEL</html>" > "$body"',
      'printf "called\n" >> ' + JSON.stringify(calls),
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const env = { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' }
    const scenarios = [
      { name: 'http11-normal-reason', firstLine: 'HTTP/1.1 200 OK', valid: true },
      { name: 'http2-empty-reason', firstLine: 'HTTP/2 200', valid: true },
      { name: 'exclamation-suffix', firstLine: 'HTTP/1.1 200!INVALID' },
      { name: 'slash-suffix', firstLine: 'HTTP/1.1 200/BROKEN' },
      { name: 'nul-suffix', firstLine: 'HTTP/1.1 200\u0000HIDDEN' },
      { name: 'unicode-suffix', firstLine: 'HTTP/2 200\u00e9' },
    ]
    for (const [index, scenario] of scenarios.entries()) {
      await t.test(scenario.name, async () => {
        await writeFile(headersFile, scenario.firstLine + '\r\nContent-Type: text/html\r\nContent-Encoding: identity\r\n\r\n')
        const outputDir = join(root, 'output-' + scenario.name)
        const capture = () => captureResearchSource('dirk-boodschappen', { env, outputDir })
        if (scenario.valid) {
          const result = await capture()
          assert.equal(result.status, 'saved')
          assert.equal(await readFile(result.html, 'utf8'), '<html>QA_STATUS_LINE_SENTINEL</html>')
          const meta = JSON.parse(await readFile(result.meta, 'utf8'))
          assert.equal(meta.httpStatus, 200)
          assert.equal(meta.type, 'research-only-not-price-proof')
          assert.equal(meta.proxyMode, 'direct')
          assert.equal((await stat(result.html)).mode & 0o077, 0)
          assert.equal((await stat(result.meta)).mode & 0o077, 0)
        } else {
          await assert.rejects(capture, /unrecognized HTTP response headers/)
          await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
        }
        assert.equal(await readFile(calls, 'utf8'), 'called\n'.repeat(index + 1),
          'one local fake curl only, without retries or proxy fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
