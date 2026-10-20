import test from 'node:test'
import assert from 'node:assert/strict'
import { createEchoServer } from '../scripts/retailer-proxy-owned-echo.mjs'

async function withEcho(callback) {
  const server = createEchoServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await callback('http://127.0.0.1:' + server.address().port) }
  finally { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())) }
}

test('owned echo returns exact independent nonce, length and no cache', async () => {
  await withEcho(async base => {
    const a = '0'.repeat(32)
    const r = await fetch(base + '/health?supa_probe=' + a)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.equal(Number(r.headers.get('content-length')), ('supa-proxy-ok:' + a).length)
    assert.equal(await r.text(), 'supa-proxy-ok:' + a)
    assert.equal((await fetch(base + '/health?supa_probe=' + 'a'.repeat(32))).status, 200)
  })
})

test('malformed method, nonces, extra keys and paths are refused', async () => {
  await withEcho(async base => {
    for (const target of [ '/health', '/other?supa_probe=' + '0'.repeat(32),
      '/health?supa_probe=bad', '/health?supa_probe=' + '0'.repeat(32) + '&x=y',
      '/health?supa_probe=' + '0'.repeat(32) + '&supa_probe=' + '0'.repeat(32)]) {
      const r = await fetch(base + target)
      assert.equal(r.status, 404)
      assert.equal(await r.text(), '')
    }
    const r = await fetch(base + '/health?supa_probe=' + '0'.repeat(32), { method: 'POST' })
    assert.equal(r.status, 404)
  })
})
