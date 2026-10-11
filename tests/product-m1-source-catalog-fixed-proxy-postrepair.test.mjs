import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RESEARCH_SOURCES, captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// No network: the only curl executable reachable through PATH is a local stub.
// The fixed proxy URL is checked as a string; no proxy socket is opened.
test('M1 all fixed registered sources retain exact URLs under approved proxy capture', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-pinned-proxy-catalog-'))
  try {
    const bin = join(root, 'bin')
    const seen = join(root, 'requested')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'test "$HTTPS_PROXY" = "http://127.0.0.1:8943/"',
      'header=""',
      'body=""',
      'writeout=0',
      'url=""',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --write-out) test "$2" = "%{http_code}" || exit 91; writeout=1; shift 2 ;;',
      '    --noproxy|--retry|--location|--compressed|--proxy) exit 92 ;;',
      '    https://*) url="$1"; shift ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$writeout" = 1 && test -n "$header" && test -n "$body" && test -n "$url"',
      'printf "%s\n" "$url" >> ' + JSON.stringify(seen),
      "printf 'HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$header\"",
      'printf "<html>PINNED_PROXY_ONLY_QA</html>" > "$body"',
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)

    const env = {
      PATH: bin + ':/usr/bin:/bin',
      SUPA_RESEARCH_APPROVED: '1',
      SUPA_RESEARCH_PROXY_URL: 'http://127.0.0.1:8943',
    }
    for (const [index, source] of RESEARCH_SOURCES.entries()) {
      await t.test(source.id, async () => {
        const originalUrl = source.url
        const alt = new URL(originalUrl)
        alt.pathname = '/unregistered-path'
        assert.equal(Reflect.set(source, 'url', alt.href), false)

        const result = await captureResearchSource(source.id, {
          env,
          outputDir: join(root, 'output-' + source.id),
        })
        const metadata = JSON.parse(await readFile(result.meta, 'utf8'))
        assert.equal(result.status, 'saved')
        assert.equal(metadata.url, originalUrl)
        assert.equal(metadata.sourceId, source.id)
        assert.equal(metadata.proxyMode, 'approved-fixed-egress')
        assert.equal(metadata.type, 'research-only-not-price-proof')
        assert.equal(await readFile(result.html, 'utf8'), '<html>PINNED_PROXY_ONLY_QA</html>')
        assert.equal((await stat(result.html)).mode & 0o077, 0)
        assert.equal((await stat(result.meta)).mode & 0o077, 0)
        assert.deepEqual((await readFile(seen, 'utf8')).trim().split('\n'),
          RESEARCH_SOURCES.slice(0, index + 1).map((entry) => entry.url),
          'one local fake request per exact registered source, without fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
