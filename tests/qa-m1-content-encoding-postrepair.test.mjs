import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureResearchSource, RESEARCH_SOURCES } from '../scripts/m1-multistore-research.mjs'

// Independent offline acceptance for #1283 on its immutable repaired writer.
// The only executable named curl is a local fixture stub: never contact a retailer.
test('M1 research capture accepts only raw identity HTML; encoded variants fail before private archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-encoding-qa-'))
  try {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const headerFixture = join(root, 'headers.fixture')
    const bodyFixture = join(root, 'body.fixture')
    const invocationLog = join(root, 'fake-curl.log')
    const stub = [
      '#!/bin/sh',
      'set -eu',
      "header=''",
      "body=''",
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --compressed|--location|--location-trusted|--retry) exit 91 ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test -n "$header" && test -n "$body"',
      'cat ' + JSON.stringify(headerFixture) + ' > "$header"',
      'cp ' + JSON.stringify(bodyFixture) + ' "$body"',
      'printf "invoked\\n" >> ' + JSON.stringify(invocationLog),
      "printf '200'",
      '',
    ].join('\n')
    await writeFile(join(bin, 'curl'), stub)
    await chmod(join(bin, 'curl'), 0o700)
    const body = '<html>QA_PRIVATE_BODY_SENTINEL</html>'
    await writeFile(bodyFixture, body)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const source = RESEARCH_SOURCES.find(item => item.id === 'dirk-boodschappen')
    assert.ok(source)
    const cases = [
      { name: 'no-encoding', header: '' },
      { name: 'identity-with-whitespace-and-mixed-case', header: 'cOnTeNt-EnCoDiNg:   IDENTITY  \r\n' },
      { name: 'gzip', header: 'Content-Encoding: gzip\r\n', rejects: true },
      { name: 'br', header: 'Content-Encoding: br\r\n', rejects: true },
      { name: 'deflate', header: 'Content-Encoding: deflate\r\n', rejects: true },
      { name: 'duplicate-case-insensitive', header: 'Content-Encoding: identity\r\ncONTENT-eNCODING: identity\r\n', rejects: true },
      { name: 'comma-list', header: 'Content-Encoding: identity, gzip\r\n', rejects: true },
      { name: 'empty', header: 'Content-Encoding:\r\n', rejects: true },
      { name: 'whitespace-only', header: 'Content-Encoding:   \t\r\n', rejects: true },
    ]
    let invocations = 0
    for (const scenario of cases) {
      const outputDir = join(root, 'out-' + scenario.name)
      await writeFile(headerFixture, 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n' + scenario.header + '\r\n')
      const capture = () => captureResearchSource('dirk-boodschappen', {
        outputDir,
        env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
      })
      if (scenario.rejects) {
        await assert.rejects(capture, error => {
          assert.match(error.message, /content-encoding/)
          assert.doesNotMatch(error.message, /QA_PRIVATE_BODY_SENTINEL/)
          return true
        }, scenario.name)
        await assert.rejects(readdir(outputDir), { code: 'ENOENT' }, scenario.name)
      } else {
        const saved = await capture()
        assert.equal(saved.status, 'saved', scenario.name)
        assert.equal(saved.sourceId, source.id)
        assert.equal(saved.sha256, sha256)
        assert.equal(await readFile(saved.html, 'utf8'), body)
        const metadata = JSON.parse(await readFile(saved.meta, 'utf8'))
        assert.equal(metadata.type, 'research-only-not-price-proof')
        assert.equal(metadata.sourceId, source.id)
        assert.equal(metadata.url, source.url)
        assert.equal(metadata.mediaType, 'text/html')
        assert.equal(metadata.proxyMode, 'direct')
        assert.equal(metadata.sha256, sha256)
        assert.equal(metadata.bytes, Buffer.byteLength(body))
        assert.equal((await stat(outputDir)).mode & 0o077, 0, scenario.name + ' output rights')
        assert.equal((await stat(join(outputDir, source.id))).mode & 0o077, 0, scenario.name + ' source rights')
        assert.equal((await stat(saved.html)).mode & 0o077, 0, scenario.name + ' HTML rights')
        assert.equal((await stat(saved.meta)).mode & 0o077, 0, scenario.name + ' metadata rights')
        assert.deepEqual((await readdir(join(outputDir, source.id))).sort(), [
          saved.html.split('/').at(-1), saved.meta.split('/').at(-1),
        ].sort())
      }
      invocations += 1
      assert.equal((await readFile(invocationLog, 'utf8')).trim().split('\n').length, invocations,
        scenario.name + ': fake curl invoked once, without retry')
    }
    assert.equal(await readFile(bodyFixture, 'utf8'), body, 'fixture stays entirely local')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
