import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'

// QA of DRAFT sync feature #3777 only. All keys and shopping labels are fictional.
// No real buyer/device keys, retailer data, network beyond 127.0.0.1, or CI mutation.
const ORIGIN = 'https://supa-qa.invalid'
const KEY = 'S'.repeat(43)
const PROGRESS_KEY = 'supa:shopping-list-progress:v1'

async function withLocalApi(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-sync-unicode-qa-'))
  const server = createRecipeServer({
    root,
    origin: ORIGIN,
    syncStore: createFileSyncStore({ dir: join(root, 'sync') }),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  return { port: server.address().port }
}

function shoppingEntries(basketKey) {
  return {
    [PROGRESS_KEY]: JSON.stringify({
      schemaVersion: 1, basketKey, doneLineIds: [],
    }),
  }
}

async function postInChunks(port, body, splitAt = null) {
  const bytes = Buffer.from(body, 'utf8')
  const chunks = splitAt === null ? [bytes] : [
    bytes.subarray(0, splitAt), bytes.subarray(splitAt),
  ]
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      method: 'PUT',
      path: '/api/sync',
      headers: {
        Authorization: 'Bearer ' + KEY,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
    }, res => {
      const output = []
      res.on('data', chunk => output.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        let result = null
        try { result = JSON.parse(Buffer.concat(output).toString('utf8')) } catch {}
        resolve({ status: res.statusCode, result })
      })
    })
    req.on('error', reject)
    req.write(chunks[0])
    if (chunks.length === 1) req.end()
    else setTimeout(() => req.end(chunks[1]), 25)
  })
}

async function readProgress(port) {
  const resp = await fetch('http://127.0.0.1:' + port + '/api/sync', {
    headers: { Authorization: 'Bearer ' + KEY },
  })
  assert.equal(resp.status, 200)
  const record = await resp.json()
  return record
}

const fixtures = [
  ['two-byte é', 'Café', 'é'],
  ['three-byte €', '€uro-fixture', '€'],
  ['four-byte emoji', 'Test 🍱 basket', '🍱'],
]

test('positive control: contiguous UTF-8 JSON sync persists fictional Unicode shopping progress', async t => {
  const { port } = await withLocalApi(t)
  const label = 'Café € 🍱 fixture-only'
  const raw = JSON.stringify({ baseRevision: 0, entries: shoppingEntries(label) })
  const response = await postInChunks(port, raw)
  assert.equal(response.status, 200)
  assert.equal(response.result.revision, 1)
  const saved = await readProgress(port)
  assert.equal(JSON.parse(saved.entries[PROGRESS_KEY]).basketKey, label)
})

for (const [name, label, character] of fixtures) {
  test('P1 sync: split valid UTF-8 body at a '+name+' byte boundary without altering stored content', async t => {
    const { port } = await withLocalApi(t)
    const raw = JSON.stringify({ baseRevision: 0, entries: shoppingEntries(label) })
    const bytes = Buffer.from(raw, 'utf8')
    const boundary = bytes.indexOf(Buffer.from(character, 'utf8'))
    assert.ok(boundary >= 0, 'fixture must contain target UTF-8 sequence')
    const splitAt = boundary + 1
    const decoded = Buffer.concat([bytes.subarray(0, splitAt), bytes.subarray(splitAt)]).toString('utf8')
    assert.equal(decoded, raw, 'original request bytes remain valid UTF-8 JSON')

    const result = await postInChunks(port, raw, splitAt)
    assert.equal(result.status, 200, 'server must accept valid JSON from HTTP chunking')
    assert.equal(result.result.revision, 1)
    const state = await readProgress(port)
    assert.equal(state.revision, 1)
    const saved = JSON.parse(state.entries[PROGRESS_KEY])
    assert.equal(saved.basketKey, label,
      'streaming boundary inside one UTF-8 code point must never introduce Unicode replacement characters')
    assert.equal(state.entries[PROGRESS_KEY], shoppingEntries(label)[PROGRESS_KEY],
      'exact persisted shopping list JSON bytes must survive network framing')
  })
}
