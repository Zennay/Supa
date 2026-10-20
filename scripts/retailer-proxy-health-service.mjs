#!/usr/bin/env node
// Independently scheduled, fail-closed candidate health checks against an explicitly
// operator-owned HTTPS echo endpoint. No supermarket requests or proxy fallback.
import http from 'node:http'
import tls from 'node:tls'
import { randomBytes } from 'node:crypto'
import { promises as fs, constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PROXY_FEED, ProxyHealthPool, parseProxyCandidates,
} from './retailer-proxy-pool.mjs'

const MAX_FEED_BYTES = 512_000
const MAX_ECHO_BYTES = 512
const SCHEMA_VERSION = 1

export function validatedOwnedEndpoint(rawUrl, ownedHost) {
  if (typeof rawUrl !== 'string' || !rawUrl || typeof ownedHost !== 'string' || !ownedHost) {
    throw new Error('An explicitly owned HTTPS echo endpoint and hostname are required')
  }
  let url
  try { url = new URL(rawUrl) } catch { throw new Error('Invalid owned HTTPS endpoint') }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search ||
      !/^[a-z0-9.-]+$/i.test(ownedHost) || !ownedHost.includes('.') ||
      url.hostname.toLowerCase() !== ownedHost.toLowerCase() ||
      ['localhost', 'example.com'].includes(url.hostname.toLowerCase()) ||
      /(?:^|\.)(?:local|localhost|internal|test)$/.test(url.hostname.toLowerCase())) {
    throw new Error('Owned endpoint must be exact public HTTPS hostname, port 443, no query or credentials')
  }
  return url
}

// Limit the response while streaming; response.text() alone permits an unbounded
// response from an untrusted candidate provider even if Content-Length is absent.
export async function boundedCandidateDownload(fetchFn = fetch) {
  const response = await fetchFn(DEFAULT_PROXY_FEED, {
    redirect: 'error', credentials: 'omit',
    headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(10_000),
  })
  if (!response?.ok || response.status !== 200 || response.url !== DEFAULT_PROXY_FEED ||
      Number(response.headers?.get?.('content-length') || 0) > MAX_FEED_BYTES ||
      !response.body?.getReader) throw new Error('Proxy candidate source unavailable or untrusted')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('Invalid proxy feed chunk')
      size += value.byteLength
      if (size > MAX_FEED_BYTES) throw new Error('Proxy candidate source too large')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  return parseProxyCandidates(Buffer.concat(chunks).toString('utf8'))
}

// A real HTTP CONNECT followed by certificate-verified HTTPS, with a nonce echoed
// by the operator's own endpoint. No third-party site, auth, cookies or redirects.
export async function probeViaOwnedHttps(candidate, endpoint, { timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000 ||
      parseProxyCandidates(candidate.replace(/^http:\/\//, '')).length !== 1 ||
      !candidate.startsWith('http://')) return { ok: false, ownedEndpoint: false }
  const parsed = new URL(candidate)
  const nonce = randomBytes(16).toString('hex')
  const requestPath = endpoint.pathname + (endpoint.pathname.includes('?') ? '&' : '?') + 'supa_probe=' + nonce
  const expected = Buffer.from('supa-proxy-ok:' + nonce, 'ascii')
  const started = performance.now()
  return await new Promise((resolve) => {
    let settled = false
    let socket
    let secure
    let req
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      secure?.destroy()
      socket?.destroy()
      req?.destroy()
      resolve({ ok, ownedEndpoint: true, latencyMs: Math.round(performance.now() - started) })
    }
    req = http.request({
      hostname: parsed.hostname, port: Number(parsed.port), method: 'CONNECT',
      path: endpoint.hostname + ':443', agent: false,
      headers: { host: endpoint.hostname + ':443' },
    })
    req.on('error', () => finish(false))
    req.on('response', () => finish(false))
    req.on('connect', (response, connectedSocket, head) => {
      socket = connectedSocket
      if (response.statusCode !== 200 || head.length) return finish(false)
      secure = tls.connect({ socket, servername: endpoint.hostname, rejectUnauthorized: true }, () => {
        secure.write('GET ' + requestPath + ' HTTP/1.1\r\n' +
          'Host: ' + endpoint.hostname + '\r\nAccept: text/plain\r\nConnection: close\r\n\r\n')
      })
      let raw = Buffer.alloc(0)
      secure.on('data', (chunk) => {
        raw = Buffer.concat([raw, chunk])
        if (raw.byteLength > MAX_ECHO_BYTES + 2048) return finish(false)
        const boundary = raw.indexOf('\r\n\r\n')
        if (boundary < 0) return
        const header = raw.subarray(0, boundary).toString('latin1')
        const body = raw.subarray(boundary + 4)
        if (!/^HTTP\/1\.[01] 200(?: |\r\n)/.test(header) ||
            /\r\n(?:transfer-encoding|content-encoding|location):/i.test(header)) return finish(false)
        const lengths = [...header.matchAll(/\r\ncontent-length:\s*(\d+)\s*(?:\r\n|$)/ig)]
        if (lengths.length !== 1 || Number(lengths[0][1]) !== expected.length ||
            body.length > expected.length) return finish(false)
        if (body.length === expected.length) finish(body.equals(expected))
      })
      secure.on('error', () => finish(false))
      secure.on('end', () => finish(false))
    })
    req.end()
  })
}

function safeEntry(candidate, value, now) {
  if (typeof candidate !== 'string' ||
      parseProxyCandidates(candidate.replace(/^http:\/\//, '')).length !== 1 ||
      candidate !== 'http://' + candidate.replace(/^http:\/\//, '') ||
      !value || typeof value !== 'object') return null
  const validTime = (n) => Number.isSafeInteger(n) && n >= 0 && n <= now
  if (!Number.isSafeInteger(value.failures) || value.failures < 0 || value.failures > 16 ||
      (value.healthyAt !== null && !validTime(value.healthyAt)) ||
      (value.latencyMs !== null && (!Number.isFinite(value.latencyMs) || value.latencyMs < 0 || value.latencyMs > 5000)) ||
      !Number.isSafeInteger(value.retryAfter) || value.retryAfter < 0 ||
      value.retryAfter > now + 24 * 3600_000) return null
  return [candidate, { failures: value.failures, healthyAt: value.healthyAt,
    latencyMs: value.latencyMs, retryAfter: value.retryAfter }]
}

export function hydratePool(data, now) {
  const pool = new ProxyHealthPool()
  if (data === null) return pool
  if (!data || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.entries) ||
      data.entries.length > 1024 ||
      (data.lastRefreshAt !== null && (!Number.isSafeInteger(data.lastRefreshAt) ||
        data.lastRefreshAt < 0 || data.lastRefreshAt > now))) {
    throw new Error('Invalid persisted proxy state')
  }
  for (const item of data.entries) {
    if (!Array.isArray(item) || item.length !== 2) throw new Error('Invalid proxy state entry')
    const entry = safeEntry(item[0], item[1], now)
    if (!entry || pool.entries.has(entry[0])) throw new Error('Invalid proxy state candidate')
    pool.entries.set(entry[0], entry[1])
  }
  pool.lastRefreshAt = data.lastRefreshAt
  return pool
}

export async function loadPool(file, now) {
  let fd
  try {
    fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await fd.stat()
    if (!stat.isFile() || stat.size > 200_000 || (stat.mode & 0o077)) {
      throw new Error('Proxy state must be a private regular file')
    }
    const bytes = await fd.readFile({ encoding: 'utf8' })
    return hydratePool(JSON.parse(bytes), now)
  } catch (err) {
    if (err.code === 'ENOENT') return new ProxyHealthPool()
    throw err
  } finally { await fd?.close() }
}

export async function storePool(file, pool) {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(dir)
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Unsafe proxy state directory')
  const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp'
  const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION,
    lastRefreshAt: pool.lastRefreshAt, entries: [...pool.entries] })
  if (Buffer.byteLength(payload) > 200_000) throw new Error('Proxy state too large')
  let fd
  try {
    fd = await fs.open(temp, 'wx', 0o600)
    await fd.writeFile(payload)
    await fd.sync()
    await fd.close(); fd = null
    await fs.rename(temp, file)
  } finally { await fd?.close(); await fs.unlink(temp).catch(() => {}) }
}

export async function runCycle({
  now = Date.now(), stateFile,
  ownedUrl, ownedHost, fetchCandidates = boundedCandidateDownload,
  probe = probeViaOwnedHttps, maxChecks = 8,
} = {}) {
  const endpoint = validatedOwnedEndpoint(ownedUrl, ownedHost)
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(maxChecks) ||
      maxChecks < 1 || maxChecks > 20 || typeof stateFile !== 'string' || !path.isAbsolute(stateFile)) {
    throw new Error('Invalid proxy service configuration')
  }
  const pool = await loadPool(stateFile, now)
  let refreshed = false
  let feedFailure = false
  if (pool.needsRefresh(now)) {
    try {
      const candidates = await fetchCandidates()
      pool.refresh(candidates, now)
      refreshed = true
    } catch { feedFailure = true }
  }
  // Prioritize untried candidates: failed proxies must not monopolize every tick.
  const due = pool.dueForProbe(now)
    .sort((a, b) => pool.entries.get(a).failures - pool.entries.get(b).failures)
    .slice(0, maxChecks)
  let probed = 0
  for (const candidate of due) {
    const outcome = await probe(candidate, endpoint).catch(() => ({ ok: false, ownedEndpoint: false }))
    pool.recordProbe(candidate, outcome, now)
    probed++
  }
  await storePool(stateFile, pool)
  return { mode: 'owned-echo-only', retailerTraffic: false, publishedPrices: false,
    refreshed, feedFailure, probed, ...pool.summary(now) }
}

async function cli(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !['--once', '--status'].includes(argv[0])) {
    throw new Error('Usage: retailer-proxy-health-service.mjs --once | --status')
  }
  const file = process.env.SUPA_PROXY_STATE_FILE ||
    path.join(os.homedir(), '.local', 'state', 'supa-proxy-health', 'state.json')
  if (argv[0] === '--status') {
    const pool = await loadPool(file, Date.now())
    console.log(JSON.stringify({ mode: 'owned-echo-only', retailerTraffic: false,
      ...pool.summary(Date.now()) }))
  } else {
    const result = await runCycle({ stateFile: file,
      ownedUrl: process.env.SUPA_PROXY_OWNED_ECHO_URL,
      ownedHost: process.env.SUPA_PROXY_OWNED_HOST })
    console.log(JSON.stringify(result))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => { console.error('Supa proxy health: ' + error.message); process.exitCode = 2 })
}