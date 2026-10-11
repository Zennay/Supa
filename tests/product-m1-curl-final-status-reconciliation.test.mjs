import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource } from '../scripts/m1-multistore-research.mjs'

test('M1 private capture reconciles curl final status with the final response headers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-curl-status-'))
  try {
    const bin = join(root, 'bin')
    const headers = join(root, 'headers.fixture')
    const bodyFixture = join(root, 'body.fixture')
    const statusFixture = join(root, 'curl-status.fixture')
    const calls = join(root, 'invocations')
    await mkdir(bin)
    const body = '<html>PRIVATE_STATUS_SENTINEL</html>'
    await writeFile(bodyFixture, body)
    const curl = [
      '#!/bin/sh',
      'set -eu',
      "header=''",
      "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --retry|--location|--compressed) exit 91 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test -n "$header" && test -n "$body"',
      'cat ' + JSON.stringify(headers) + ' > "$header"',
      'cat ' + JSON.stringify(bodyFixture) + ' > "$body"',
      'printf "call\\n" >> ' + JSON.stringify(calls),
      'cat ' + JSON.stringify(statusFixture),
      '',
    ].join('\n')
    await writeFile(join(bin, 'curl'), curl)
    await chmod(join(bin, 'curl'), 0o700)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const cases = [
      { name: 'matching-200', headerStatus: 200, curlStatus: '200', valid: true },
      { name: 'mismatch-503', headerStatus: 200, curlStatus: '503' },
      { name: 'mismatch-000', headerStatus: 200, curlStatus: '000' },
      { name: 'missing-status', headerStatus: 200, curlStatus: '' },
      { name: 'malformed-status', headerStatus: 200, curlStatus: '2xx' },
      { name: 'consistent-403', headerStatus: 403, curlStatus: '403', expectedNon200: true },
    ]
    let count = 0
    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        await writeFile(headers, 'HTTP/1.1 ' + scenario.headerStatus + ' Synthetic\r\nContent-Type: text/html\r\n\r\n')
        await writeFile(statusFixture, scenario.curlStatus)
        const outputDir = join(root, 'out-' + scenario.name)
        const capture = () => captureResearchSource('dirk-boodschappen', {
          outputDir,
          env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
        })
        if (scenario.valid) {
          const saved = await capture()
          const metadata = JSON.parse(await readFile(saved.meta, 'utf8'))
          assert.equal(saved.status, 'saved')
          assert.equal(await readFile(saved.html, 'utf8'), body)
          assert.equal(metadata.httpStatus, 200)
          assert.equal(metadata.type, 'research-only-not-price-proof')
          assert.equal(metadata.sha256, sha256)
          assert.equal((await stat(saved.html)).mode & 0o077, 0)
          assert.equal((await stat(saved.meta)).mode & 0o077, 0)
        } else {
          await assert.rejects(capture, error => {
            assert.match(error.message, scenario.expectedNon200 ? /HTTP 403/ : /status|HTTP/i)
            assert.doesNotMatch(error.message, /PRIVATE_STATUS_SENTINEL/)
            return true
          }, scenario.name)
          await assert.rejects(readdir(outputDir), { code: 'ENOENT' })
        }
        count += 1
        assert.equal((await readFile(calls, 'utf8')).trim().split('\n').length, count,
          'a single bounded offline fake curl request, no retry')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
