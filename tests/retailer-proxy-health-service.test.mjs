import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { validatedOwnedEndpoint, boundedCandidateDownload, probeViaOwnedHttps,
  runCycle, loadPool, hydratePool } from '../scripts/retailer-proxy-health-service.mjs'

const url = 'https://probe.my-owned-domain.nl/health'
const host = 'probe.my-owned-domain.nl'
const tempFile = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'supa-proxy-health-test-')), 'state.json')

function response(chunks, { status = 200, url = 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', length = '0' } = {}) {
  return { status, ok: status === 200, url,
    headers: { get: () => length },
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(Buffer.from(chunk)); controller.close() } }),
  }
}

test('owned endpoint must be explicitly whitelisted, public HTTPS and credential-free', () => {
  assert.equal(validatedOwnedEndpoint(url, host).hostname, host)
  for (const [u, h] of [
    ['http://probe.my-owned-domain.nl/health', host],
    ['https://probe.my-owned-domain.nl:8443/health', host],
    ['https://other-domain.nl/health', host],
    ['https://user:secret@probe.my-owned-domain.nl/health', host],
    ['https://probe.my-owned-domain.nl/health?token=x', host],
    ['https://probe.my-owned-domain.nl/health#abc', host],
    ['https://example.com/', 'example.com'],
    ['https://localhost/health', 'localhost'],
    ['', host], [url, ''],
  ]) assert.throws(() => validatedOwnedEndpoint(u, h))
})

test('feed is exact URL, bounded even without Content-Length, never redirected', async () => {
  const ok = await boundedCandidateDownload(async (u, o) => {
    assert.equal(u, 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt')
    assert.equal(o.redirect, 'error')
    assert.equal(o.credentials, 'omit')
    return response(['8.8.8.8:3128\n', '8.8.8.8:3128\n', '127.0.0.1:3000'])
  })
  assert.deepEqual(ok, ['http://8.8.8.8:3128'])
  await assert.rejects(() => boundedCandidateDownload(async () => response(['ok'], { url: 'https://proxy.evil' })))
  await assert.rejects(() => boundedCandidateDownload(async () => response(['x'.repeat(512001)])), /too large/)
  await assert.rejects(() => boundedCandidateDownload(async () => response(['ok'], { length: '9999999' })))
  await assert.rejects(() => boundedCandidateDownload(async () => response(['ok'], { status: 403 })))
})

test('one owned-probe cycle fetches, tests, persists, reuses and hourly refreshes', async () => {
  const file = await tempFile()
  let fetched = 0
  let checked = 0
  const fetchCandidates = async () => { fetched++; return ['http://8.8.8.8:8080', 'http://1.1.1.1:3128'] }
  const probe = async () => { checked++; return { ok: true, ownedEndpoint: true, latencyMs: 23 } }
  const args = { stateFile: file, ownedUrl: url, ownedHost: host, fetchCandidates, probe }
  const initial = await runCycle({ ...args, now: 1000 })
  assert.equal(initial.refreshed, true)
  assert.equal(initial.candidates, 2)
  assert.equal(initial.healthy, 2)
  assert.equal(initial.probed, 2)
  assert.equal(initial.retailerTraffic, false)
  assert.equal(fetched, 1)
  assert.equal(checked, 2)
  const stat = await (await import('node:fs/promises')).stat(file)
  assert.equal(stat.mode & 0o077, 0)
  const second = await runCycle({ ...args, now: 1000 + 5 * 60_000 })
  assert.equal(second.refreshed, false)
  assert.equal(second.probed, 0)
  assert.equal(fetched, 1)
  const expired = await runCycle({ ...args, now: 1000 + 16 * 60_000 })
  assert.equal(expired.probed, 2)
  const hourly = await runCycle({ ...args, now: 1000 + 61 * 60_000 })
  assert.equal(hourly.refreshed, true)
  assert.equal(fetched, 2)
  assert.equal(hourly.healthy, 2)
})

test('unknown or blocked proxies are never accepted, failures quarantine, refresh failure stays private', async () => {
  const file = await tempFile()
  let n = 0
  const args = { stateFile: file, ownedUrl: url, ownedHost: host,
    fetchCandidates: async () => ['http://8.8.8.8:8080'],
    probe: async () => { n++; return { ok: true, ownedEndpoint: false, latencyMs: 10 } },
  }
  const first = await runCycle({ ...args, now: 1000 })
  assert.equal(first.healthy, 0)
  assert.equal(first.probed, 1)
  const next = await runCycle({ ...args, now: 3000 })
  assert.equal(next.probed, 0)
  assert.equal(n, 1)
  const loss = await runCycle({ ...args, now: 1000 + 3_600_000,
    fetchCandidates: async () => { throw new Error('source down') } })
  assert.equal(loss.feedFailure, true)
  assert.equal(loss.healthy, 0)
  assert.equal(loss.retailerTraffic, false)
  assert.equal((await loadPool(file, 1000 + 3_600_000)).entries.size, 1)
})

test('reject world-readable, malformed and forged persisted state', async () => {
  const file = await tempFile()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ schemaVersion: 1, lastRefreshAt: null, entries: [] }))
  await chmod(file, 0o644)
  await assert.rejects(() => loadPool(file, 123), /private/)
  await chmod(file, 0o600)
  await writeFile(file, '{broken-json')
  await assert.rejects(() => loadPool(file, 123), /JSON/)
  assert.throws(() => hydratePool({ schemaVersion: 1, lastRefreshAt: 9999, entries: [] }, 123))
  assert.throws(() => hydratePool({ schemaVersion: 1, lastRefreshAt: 0, entries: [['http://127.0.0.1:80',
    { failures: 0, healthyAt: null, latencyMs: null, retryAfter: 0 }]] }, 123))
})

test('real transport refuses malformed local, credential and external endpoint candidates before connecting', async () => {
  for (const candidate of ['http://127.0.0.1:8888', 'http://user:pass@8.8.8.8:80', 'https://8.8.8.8:80']) {
    const result = await probeViaOwnedHttps(candidate, validatedOwnedEndpoint(url, host))
    assert.equal(result.ok, false)
  }
})

test('invalid endpoint and state path fail before fetching or probing', async () => {
  let invoked = false
  await assert.rejects(() => runCycle({ stateFile: 'state.json', ownedUrl: url, ownedHost: host,
    fetchCandidates: async () => { invoked = true; return [] } }))
  await assert.rejects(() => runCycle({ stateFile: '/tmp/unused', ownedUrl: 'https://example.com',
    ownedHost: 'example.com', fetchCandidates: async () => { invoked = true; return [] } }))
  assert.equal(invoked, false)
})

test('failed first batch cannot starve fresh untested candidates on later timer cycles', async () => {
  const stateFile = await tempFile()
  const sampled = []
  const candidates = Array.from({ length: 13 }, (_, n) => 'http://8.8.8.' + (n + 1) + ':8080')
  const args = { stateFile, ownedUrl: url, ownedHost: host, maxChecks: 5,
    fetchCandidates: async () => candidates,
    probe: async (candidate) => { sampled.push(candidate); return { ok: false, ownedEndpoint: true, latencyMs: 9 } },
  }
  const first = await runCycle({ ...args, now: 1000 })
  assert.equal(first.probed, 5)
  const second = await runCycle({ ...args, now: 1000 + 5 * 60_000 })
  assert.equal(second.probed, 5)
  assert.equal(new Set(sampled).size, 10)
})