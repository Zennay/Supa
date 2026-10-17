import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecipeServer } from '../server/app.mjs'
import { createFileSyncStore } from '../server/sync-store.mjs'
import { SYNC_KEYS, validateSyncEntries } from '../server/sync-validation.mjs'

const key = 'k'.repeat(43)
const origin = 'https://supa.example.org'
const planner = JSON.stringify({ budget: 35, activeDays: ['Ma', 'Di'], recipeByDay: { Ma: 'supa-thai' } })

async function withServer(run, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-sync-'))
  const root = join(dir, 'dist')
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>SUPA</title>')
  await writeFile(join(root, 'assets', 'app-abc123.js'), 'export {}')
  const server = createRecipeServer({ root, origin, syncStore: createFileSyncStore({ dir: join(dir, 'sync') }), ...options })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try { await run(base, dir) } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
}

const put = (base, body, headers = {}) => fetch(`${base}/api/sync`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${key}`, origin, 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('sync validation accepts exactly the app-readable records and nothing else', () => {
  assert.deepEqual(SYNC_KEYS, ['supa:planner-preferences:v2', 'supa.recipe-library.v1', 'supa:shopping-list-progress:v1'])
  assert.ok(validateSyncEntries({ 'supa:planner-preferences:v2': planner }).entries)
  assert.ok(validateSyncEntries({}).entries, 'an empty device is valid')
  assert.match(validateSyncEntries({ 'supa:m3-observation-draft:v1': '{}' }).error, /Onbekend/)
  assert.match(validateSyncEntries({ 'supa:planner-preferences:v2': '{"v":3}' }).error, /weekplanning/)
  assert.match(validateSyncEntries({ 'supa:planner-preferences:v2': JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: { Ma: 'own-missing' } }) }).error, /weekplanning/)
  assert.match(validateSyncEntries({ 'supa.recipe-library.v1': '{"version":2}' }).error, /recepten/)
  assert.match(validateSyncEntries({ 'supa:shopping-list-progress:v1': '{"schemaVersion":1,"basketKey":"x","doneLineIds":["a","a"]}' }).error, /boodschappenlijst/)
  assert.ok(validateSyncEntries({ 'supa:shopping-list-progress:v1': '{"schemaVersion":1,"basketKey":"x","doneLineIds":["a"]}' }).entries)
  assert.match(validateSyncEntries({ 'supa:planner-preferences:v2': 7 }).error, /Ongeldige/)
})

test('own recipes saved in the same snapshot may be planned', () => {
  const library = JSON.stringify({ version: 1, recipes: [{
    id: 'own-1', savedAt: '2026-10-17T08:00:00.000Z', source: 'manual', sourceUrl: null,
    title: 'Linzensoep', servings: 2, minutes: 30,
    ingredients: [{ original: '200 g linzen' }, { original: '1 l bouillon' }], steps: ['Kook alles 25 minuten.'],
  }] })
  const plan = JSON.stringify({ budget: 35, activeDays: ['Ma'], recipeByDay: { Ma: 'own-1' } })
  const result = validateSyncEntries({ 'supa.recipe-library.v1': library, 'supa:planner-preferences:v2': plan })
  assert.equal(result.error, undefined)
})

test('health, unknown API routes and static caching are explicit', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/api/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok', features: { recipeImport: true, sync: true } })
    const missing = await fetch(`${base}/api/nope`)
    assert.equal(missing.status, 404)
    assert.match(missing.headers.get('content-type'), /application\/json/)
    const shell = await fetch(`${base}/planner`)
    assert.equal(shell.status, 200)
    assert.equal(shell.headers.get('cache-control'), 'no-cache')
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    assert.match(asset.headers.get('cache-control'), /immutable/)
    assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404)
  })
})

test('device sync round-trips, rejects stale revisions and never writes the bearer key to disk', async () => {
  await withServer(async (base, dir) => {
    const empty = await fetch(`${base}/api/sync`, { headers: { authorization: `Bearer ${key}` } })
    assert.deepEqual(await empty.json(), { revision: 0, updatedAt: null, entries: {} })

    const first = await put(base, { baseRevision: 0, entries: { 'supa:planner-preferences:v2': planner } })
    assert.equal(first.status, 200)
    assert.equal((await first.json()).revision, 1)

    const stale = await put(base, { baseRevision: 0, entries: {} })
    assert.equal(stale.status, 409)
    const current = await stale.json()
    assert.equal(current.revision, 1)
    assert.equal(current.entries['supa:planner-preferences:v2'], planner)

    const read = await (await fetch(`${base}/api/sync`, { headers: { authorization: `Bearer ${key}` } })).json()
    assert.equal(read.entries['supa.recipe-library.v1'], null)

    const files = await readdir(join(dir, 'sync'))
    assert.equal(files.length, 1)
    assert.ok(!files[0].includes(key))
    assert.ok(!(await readFile(join(dir, 'sync', files[0]), 'utf8')).includes(key))
  })
})

test('sync refuses missing keys, foreign origins, invalid records and oversized bodies', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/api/sync`)).status, 401)
    assert.equal((await fetch(`${base}/api/sync`, { headers: { authorization: 'Bearer short' } })).status, 401)
    assert.equal((await put(base, { baseRevision: 0, entries: {} }, { origin: 'https://evil.example.org' })).status, 403)
    assert.equal((await put(base, { baseRevision: 0, entries: {} }, { 'content-type': 'text/plain' })).status, 403)
    assert.equal((await put(base, { baseRevision: -1, entries: {} })).status, 400)
    assert.equal((await put(base, { baseRevision: 0, entries: { 'supa:planner-preferences:v2': '{' } })).status, 422)
    const huge = await put(base, { baseRevision: 0, entries: { 'supa.recipe-library.v1': 'x'.repeat(2_600_000) } })
    assert.equal(huge.status, 413)
    assert.equal((await fetch(`${base}/api/sync`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } })).status, 405)
  })
})

test('concurrent writes from two tabs with the same base revision cannot both win', async () => {
  await withServer(async base => {
    const [a, b] = await Promise.all([
      put(base, { baseRevision: 0, entries: { 'supa:planner-preferences:v2': planner } }),
      put(base, { baseRevision: 0, entries: {} }),
    ])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
  })
})

test('dev proxy keeps the browser Host so same-origin API writes work in `npm run dev`', async () => {
  const { readFile } = await import('node:fs/promises')
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(config, /'\/api': \{ target: 'http:\/\/127\.0\.0\.1:4174', changeOrigin: false \}/)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['dev:full'], 'node scripts/dev-full.mjs')
  assert.equal(pkg.scripts.start, 'node --experimental-strip-types server/app.mjs')
})

test('global CAS holds for many writers across store instances, and a crashed writer\'s lock is recovered', async () => {
  const { utimes } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const dir = await mkdtemp(join(tmpdir(), 'supa-sync-stress-'))
  try {
    const stores = [0, 1, 2].map(() => createFileSyncStore({ dir }))
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      stores[i % 3].write(key, 0, { 'supa:planner-preferences:v2': `{"writer":${i}}` })))
    const winners = results.filter(result => !result.conflict)
    assert.equal(winners.length, 1)
    assert.ok(results.filter(result => result.conflict).every(result => result.record.revision === 1))
    assert.deepEqual((await stores[2].read(key)).entries, winners[0].record.entries)
    assert.deepEqual((await readdir(dir)).filter(name => !name.endsWith('.json')), [], 'no lock or temp files left behind')

    const lock = join(dir, `${createHash('sha256').update(key).digest('hex')}.lock`)
    await writeFile(lock, '')
    const old = new Date(Date.now() - 60_000)
    await utimes(lock, old, old)
    const after = await stores[0].write(key, 1, {})
    assert.equal(after.conflict, false)
    assert.equal(after.record.revision, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('split UTF-8 in recipe import bodies is decoded exactly; malformed bytes are refused', async () => {
  const { request } = await import('node:http')
  let seen
  const server = createRecipeServer({ origin, syncStore: null, fetchHtml: async url => { seen = url; throw new Error('stop') } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const send = parts => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/recipes/import', headers: { origin, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.on('error', reject)
    req.write(parts[0]); setTimeout(() => req.end(parts[1]), 20)
  })
  try {
    const bytes = Buffer.from(JSON.stringify({ url: 'https://example.org/crème-brûlée' }))
    const cut = bytes.indexOf(Buffer.from('è')) + 1
    await send([bytes.subarray(0, cut), bytes.subarray(cut)])
    assert.equal(seen, 'https://example.org/crème-brûlée')
    seen = undefined
    assert.equal(await send([Buffer.from('{"url":"https://example.org/'), Buffer.from([0xff, 0x22, 0x7d])]), 422)
    assert.equal(seen, undefined, 'malformed bodies never reach the fetcher')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
