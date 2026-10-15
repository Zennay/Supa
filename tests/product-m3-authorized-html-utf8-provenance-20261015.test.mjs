import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fetchAuthorizedRetailerHtml } from '../scripts/retailer-authorized-fetch.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Fictional, injected response and licence. No actual retailer HTTP or rights.
const rights = {
  version: 1, milestone: 'M1 Data Feasibility', reviewedAt: '2026-10-15',
  sources: ['plus', 'dekamarkt'].map(supermarket => ({
    supermarket, technicalStatus: 'proven', permissionStatus: 'permitted',
    productionEnabled: true, evidence: [{kind: 'written_permission',
      url: 'https://example.org/fictional-only', finding: 'MOCK: NOT REAL RIGHTS'}],
  })),
}
const source = SOURCES.find(entry => entry.id === 'plus-product-halfvolle-melk')
const at = Date.parse('2026-10-15T10:00:00Z')

async function capture(bytes) {
  let requests = 0
  const result = fetchAuthorizedRetailerHtml({
    sourceId: source.id, enableLive: true, permissionDocument: rights,
    capturedAtMs: at, maxBytes: 1024,
    fetchImpl: async (url, opts) => {
      requests++
      assert.equal(url, source.url)
      assert.equal(opts.redirect, 'error')
      assert.equal(opts.credentials, 'omit')
      return {
        url: source.url, status: 200, ok: true,
        headers: { get: key => key === 'content-type' ? 'text/html' : null },
        body: new ReadableStream({
          start(controller) { controller.enqueue(bytes); controller.close() },
        }),
      }
    },
  })
  return { result, requests: () => requests }
}

for (const bytes of [
  Buffer.from([0x3c, 0xff, 0x3e]),
  Buffer.from([0x3c, 0xe2, 0x82]),
  Buffer.from([0xc0, 0xaf]),
  Buffer.from([0xed, 0xa0, 0x80]),
]) {
  test('M3 authorized mock response rejects invalid UTF-8 before returning evidence ' + bytes.toString('hex'), async () => {
    const call = await capture(bytes)
    await assert.rejects(call.result, /Invalid UTF-8/)
    assert.equal(call.requests(), 1)
  })
}

for (const [label, bytes] of [
  ['ASCII', Buffer.from('<html>mock only</html>', 'utf8')],
  ['Unicode', Buffer.from('<html>Melk 🥛</html>', 'utf8')],
  ['BOM and Unicode', Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),
    Buffer.from('<html>Melk 🥛</html>', 'utf8')])],
]) {
  test('M3 authorized mock preserves exact HTTP source bytes for ' + label, async () => {
    const call = await capture(bytes)
    const result = await call.result
    assert.equal(call.requests(), 1)
    assert.equal(result.bytes, bytes.byteLength)
    assert.deepEqual(Buffer.from(result.html, 'utf8'), bytes)
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'))
  })
}
