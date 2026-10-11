import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  RESEARCH_SOURCES,
  captureResearchSource,
  validateResearchSource,
} from '../scripts/m1-multistore-research.mjs'

// The registered set is a product-level fixed-source boundary, not simply a
// frozen array whose public entry objects can be reassigned by another import.
test('M1 registered supermarket source entries stay immutable inside the process', async t => {
  assert.equal(Object.isFrozen(RESEARCH_SOURCES), true)
  assert.equal(RESEARCH_SOURCES.length, 5)

  for (const source of RESEARCH_SOURCES) {
    await t.test(source.id, () => {
      const original = source.url
      const alternative = new URL(original)
      alternative.pathname = '/other-same-host-path'
      assert.equal(validateResearchSource({ ...source, url: alternative.href }), true,
        'same-host URL validation is not a substitute for a pinned catalog entry')

      // Reflect.set is non-throwing even in strict ESM, so the regression is
      // deterministic and does not require writing to a production source.
      let modified = false
      try {
        modified = Reflect.set(source, 'url', alternative.href)
      } finally {
        // RED ancestor has shallow-frozen entries: undo the temporary change
        // before another test module can read the shared public export.
        if (modified) Reflect.set(source, 'url', original)
      }
      assert.equal(modified, false, 'a caller must not retarget a registered source')
      assert.equal(source.url, original)
      assert.equal(Object.isFrozen(source), true)
    })
  }
})

// Keep the intended opt-in capture behavior rather than solving the problem
// by disabling research. Curl below is a local shell stub: no network traffic.
test('M1 fixed source still captures approved synthetic HTML with private provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m1-source-pinning-'))
  try {
    const bin = join(root, 'bin')
    const requested = join(root, 'requested-url')
    await mkdir(bin, { mode: 0o700 })
    await writeFile(join(bin, 'curl'), [
      '#!/bin/sh',
      'set -eu',
      'headers=""',
      'body=""',
      'noproxy=0',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    --dump-header) headers="$2"; shift 2 ;;',
      '    --output) body="$2"; shift 2 ;;',
      '    --noproxy) test "$2" = "*" || exit 91; noproxy=1; shift 2 ;;',
      '    --retry|--location|--compressed|--proxy) exit 92 ;;',
      '    https://*) printf "%s" "$1" > ' + JSON.stringify(requested) + '; shift ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'test "$noproxy" = 1 && test -n "$headers" && test -n "$body"',
      "printf 'HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\n' > \"$headers\"",
      'printf "<html>QA_FIXED_CATALOG_SENTINEL</html>" > "$body"',
      'printf 200',
      '',
    ].join('\n'))
    await chmod(join(bin, 'curl'), 0o700)
    const source = RESEARCH_SOURCES[0]
    const result = await captureResearchSource(source.id, {
      env: { PATH: bin + ':/usr/bin:/bin', SUPA_RESEARCH_APPROVED: '1' },
      outputDir: join(root, 'private'),
    })
    assert.equal(result.status, 'saved')
    assert.equal(await readFile(requested, 'utf8'), source.url)
    assert.equal(await readFile(result.html, 'utf8'), '<html>QA_FIXED_CATALOG_SENTINEL</html>')
    const metadata = JSON.parse(await readFile(result.meta, 'utf8'))
    assert.equal(metadata.url, source.url)
    assert.equal(metadata.type, 'research-only-not-price-proof')
    assert.equal(metadata.proxyMode, 'direct')
    assert.equal((await stat(result.html)).mode & 0o077, 0)
    assert.equal((await stat(result.meta)).mode & 0o077, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
