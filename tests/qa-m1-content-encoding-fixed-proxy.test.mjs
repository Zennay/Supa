import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// No socket/proxy is opened: fake curl validates only the approved fixed-proxy
// environment and writes synthetic response fixtures.
test('M1 Content-Encoding is enforced on approved fixed-proxy research path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-encoding-proxy-qa-'))
  try {
    const bin = join(root, 'bin')
    const fixture = join(root, 'response.headers')
    const log = join(root, 'stub-invocations')
    await mkdir(bin)
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'test "\${HTTPS_PROXY:-}" = "http://127.0.0.1:8123/"',
      "header=''",
      "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --noproxy|--compressed|--location|--retry) exit 92 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test -n "$header" && test -n "$body"',
      'cat ' + JSON.stringify(fixture) + ' > "$header"',
      "printf '<html>PRIVATE_PROXY_QA_SENTINEL</html>' > \"$body\"",
      'printf "called\\n" >> ' + JSON.stringify(log),
      "printf '200'",
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const env = {
      PATH: bin + ':/usr/bin:/bin',
      SUPA_RESEARCH_APPROVED: '1',
      SUPA_RESEARCH_PROXY_URL: 'http://127.0.0.1:8123',
    }
    const body = '<html>PRIVATE_PROXY_QA_SENTINEL</html>'
    const cases = [
      { name: 'identity', header: 'Content-Encoding: identity\r\n', valid: true },
      { name: 'gzip', header: 'Content-Encoding: gzip\r\n', valid: false },
      { name: 'duplicate', header: 'Content-Encoding: identity\r\nCONTENT-ENCODING: identity\r\n', valid: false },
    ]
    let invocationCount = 0
    for (const entry of cases) {
      await writeFile(fixture, 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n' + entry.header + '\r\n')
      const outputDir = join(root, 'out-' + entry.name)
      if (entry.valid) {
        const saved = await captureResearchSource('dirk-boodschappen', { env, outputDir })
        assert.equal(saved.status, 'saved')
        assert.equal(await readFile(saved.html, 'utf8'), body)
        const metadata = JSON.parse(await readFile(saved.meta, 'utf8'))
        assert.equal(metadata.proxyMode, 'approved-fixed-egress')
        assert.equal(metadata.type, 'research-only-not-price-proof')
        assert.equal((await stat(saved.html)).mode & 0o077, 0)
        assert.equal((await stat(saved.meta)).mode & 0o077, 0)
      } else {
        await assert.rejects(
          captureResearchSource('dirk-boodschappen', { env, outputDir }),
          error => {
            assert.match(error.message, /content-encoding/)
            assert.doesNotMatch(error.message, /PRIVATE_PROXY_QA_SENTINEL/)
            return true
          },
          entry.name,
        )
        await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
      }
      invocationCount += 1
      assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, invocationCount,
        'fake curl runs once with no automatic retry')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
