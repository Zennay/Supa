import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'

// Independent fail-first offline QA. Deliberately invalid UTF-8 wire bytes
// must not become valid, persisted U+FFFD replacements inside private sync.
const ORIGIN = 'https://supa-qa.invalid'
const KEY = 'T'.repeat(43)
const K = 'supa:shopping-list-progress:v1'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-invalid-utf8-'))
  const server = createRecipeServer({
    root: dir, origin: ORIGIN, syncStore: createFileSyncStore({ dir: join(dir, 'records') }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  })
  return server.address().port
}

function payload() {
  return Buffer.from(JSON.stringify({
    baseRevision: 0,
    entries: {
      [K]: JSON.stringify({
        schemaVersion: 1,
        basketKey: 'fixture-invalid-€-original',
        doneLineIds: [],
      }),
    },
  }), 'utf8')
}

async function rawPut(port, bytes) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, method: 'PUT', path: '/api/sync',
      headers: {
        Authorization: 'Bearer ' + KEY, Origin: ORIGIN, 'Content-Type': 'application/json',
      },
    }, res => {
      const buffers = []
      res.on('data', b => buffers.push(b))
      res.on('error', reject)
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(buffers).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.end(bytes)
  })
}

async function persisted(port) {
  const response = await fetch('http://127.0.0.1:' + port + '/api/sync', {
    headers: { Authorization: 'Bearer ' + KEY },
  })
  assert.equal(response.status, 200)
  return response.json()
}

const cases = [
  ['lone continuation byte', [0x80]],
  ['lone impossible lead byte', [0xff]],
  ['overlong two-byte sequence', [0xc0, 0xaf]],
  ['surrogate UTF-8 encoding', [0xed, 0xa0, 0x80]],
]

for (const [label, insertedBytes] of cases) {
  test('P1 sync: reject '+label+' instead of turning invalid UTF-8 into saved text', async t => {
    const port = await setup(t)
    const original = payload()
    const euro = Buffer.from('€', 'utf8')
    const index = original.indexOf(euro)
    assert.ok(index > 0, 'synthetic JSON must contain original UTF-8 marker')
    const broken = Buffer.concat([
      original.subarray(0, index),
      Buffer.from(insertedBytes),
      original.subarray(index + euro.length),
    ])
    assert.notDeepEqual(broken, original)
    const result = await rawPut(port, broken)
    assert.ok([400, 422].includes(result.status),
      'invalid UTF-8 input must be refused without a successful sync acknowledgment (got '+result.status+')')
    assert.equal(result.text.includes('fixture-invalid'), false, 'error response must not echo private shopping data')
    const state = await persisted(port)
    assert.equal(state.revision, 0, 'invalid wire bytes must never mint a sync revision')
    assert.deepEqual(state.entries, {}, 'no corrupted private shopping text persisted')
  })
}
