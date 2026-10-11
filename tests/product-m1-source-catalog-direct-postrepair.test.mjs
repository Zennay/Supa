import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RESEARCH_SOURCES, captureResearchSource } from '../scripts/m1-multistore-research.mjs'

// Product-core postrepair acceptance: approved *direct* routing, not the
// approved fixed-proxy route covered by the separate owner/QA test. The only
// curl executable available through PATH is the local stub below.
test('M1 fixed source catalog uses exact pinned URLs without proxy or retries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-pinned-direct-catalog-'))
  try {
    const bin = join(root, 'bin')
    const seen = join(root, 'requested')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'test -z "${HTTPS_PROXY-}" && test -z "${HTTP_PROXY-}"',
      'header=""',
      'body=""',
      'url=""',
      'noproxy=0',
      'writeout=0',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) header="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --write-out) test "$2" = "%{http_code}" || exit 87; writeout=1; shift 2 ;;',
      '    --noproxy) test "$2" = "*" || exit 88; noproxy=1; shift 2 ;;',
      '    --proto) test "$2" = "=https" || exit 89; shift 2 ;;',
      '    --retry|--location|--location-trusted|--compressed|--proxy) exit 90 ;;',
      '    https://*) test -z "$url" || exit 91; url="$1"; shift ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$noproxy" = 1 && test "$writeout" = 1',
      'test -n "$header" && test -n "$body" && test -n "$url"',
      'printf "%s\\n" "$url" >> ' + JSON.stringify(seen),
      'printf "HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n" > "$header"',
      'printf "<html>DIRECT_PINNED_OFFLINE</html>" > "$body"',
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const env = {
      PATH: bin + ':/usr/bin:/bin',
      SUPA_RESEARCH_APPROVED: '1',
    }

    for (const [index, source] of RESEARCH_SOURCES.entries()) {
      await t.test(source.id, async () => {
        const saved = await captureResearchSource(source.id, {
          env,
          outputDir: join(root, 'captures-' + source.id),
        })
        const metadata = JSON.parse(await readFile(saved.meta, 'utf8'))
        assert.equal(saved.status, 'saved')
        assert.equal(metadata.sourceId, source.id)
        assert.equal(metadata.store, source.store)
        assert.equal(metadata.url, source.url)
        assert.equal(metadata.type, 'research-only-not-price-proof')
        assert.equal(metadata.proxyMode, 'direct')
        assert.equal(metadata.httpStatus, 200)
        assert.equal(await readFile(saved.html, 'utf8'), '<html>DIRECT_PINNED_OFFLINE</html>')
        assert.equal((await stat(saved.html)).mode & 0o077, 0)
        assert.equal((await stat(saved.meta)).mode & 0o077, 0)
        assert.deepEqual((await readFile(seen, 'utf8')).trim().split('\n'),
          RESEARCH_SOURCES.slice(0, index + 1).map(entry => entry.url),
          'exactly one local no-proxy request to each registered path, no fallback')
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
