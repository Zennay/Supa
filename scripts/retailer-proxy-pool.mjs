import { isIP } from 'node:net'

// Candidate discovery only. This module NEVER sends traffic to a supermarket.
// The caller must independently enforce source permission, robots/terms and rate limits.
export const DEFAULT_PROXY_FEED =
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'

const MAX_FEED_BYTES = 512_000
const MAX_CANDIDATES = 1024

export function isPublicIPv4(host) {
  if (typeof host !== 'string' || isIP(host) !== 4) return false
  const [a, b, c] = host.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 0 || (b === 168) || (b === 88 && c === 99))) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

// Accept IP:port only; reject URLs, credentials, DNS names and private/reserved IPs.
// A candidate is NOT healthy until a caller-provided, authorized probe succeeds.
export function parseProxyCandidates(text, maxCount = MAX_CANDIDATES) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FEED_BYTES) {
    throw new Error('Proxy feed must be bounded UTF-8 text')
  }
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || maxCount > MAX_CANDIDATES) {
    throw new Error('Invalid proxy candidate limit')
  }
  const seen = new Set()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(line)) continue
    const [host, rawPort] = line.split(':')
    const port = Number(rawPort)
    if (!isPublicIPv4(host) || port < 1 || port > 65535) continue
    seen.add('http://' + host + ':' + port)
    if (seen.size >= maxCount) break
  }
  return [...seen]
}

export async function downloadProxyCandidates(fetchFn = fetch) {
  // Explicitly pinned provider and no redirects or credentials.
  const response = await fetchFn(DEFAULT_PROXY_FEED, {
    redirect: 'error',
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response?.ok) throw new Error('Proxy candidate feed unavailable')
  if (response.url && response.url !== DEFAULT_PROXY_FEED) {
    throw new Error('Unexpected proxy feed redirect')
  }
  if (Number(response.headers?.get?.('content-length')) > MAX_FEED_BYTES) {
    throw new Error('Proxy feed too large')
  }
  return parseProxyCandidates(await response.text())
}

function checkTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('Timestamp must be nonnegative safe milliseconds')
  }
}

export class ProxyHealthPool {
  constructor({
    refreshIntervalMs = 3_600_000,
    healthyTtlMs = 15 * 60_000,
    cooldownMs = 5 * 60_000,
    maxLatencyMs = 5000,
  } = {}) {
    for (const n of [refreshIntervalMs, healthyTtlMs, cooldownMs, maxLatencyMs]) {
      if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid pool config')
    }
    this.refreshIntervalMs = refreshIntervalMs
    this.healthyTtlMs = healthyTtlMs
    this.cooldownMs = cooldownMs
    this.maxLatencyMs = maxLatencyMs
    this.lastRefreshAt = null
    this.entries = new Map()
  }

  needsRefresh(now) {
    checkTime(now)
    return this.lastRefreshAt === null || now - this.lastRefreshAt >= this.refreshIntervalMs
  }

  refresh(candidates, now) {
    checkTime(now)
    if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
      throw new Error('Invalid candidate collection')
    }
    const next = new Map()
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.startsWith('http://')) continue
      const original = candidate.slice('http://'.length)
      if (parseProxyCandidates(original).length !== 1) continue
      if (next.has(candidate)) continue
      next.set(candidate, this.entries.get(candidate) || {
        failures: 0,
        healthyAt: null,
        latencyMs: null,
        retryAfter: 0,
      })
    }
    // Removed candidates cannot continue serving traffic merely because they once worked.
    this.entries = next
    this.lastRefreshAt = now
    return this.entries.size
  }

  dueForProbe(now) {
    checkTime(now)
    return [...this.entries.entries()]
      .filter(([, value]) =>
        now >= value.retryAfter &&
        (value.healthyAt === null || now - value.healthyAt >= this.healthyTtlMs)
      )
      .map(([candidate]) => candidate)
  }

  // Only accept results from the operator's own permitted HTTPS echo endpoint.
  // blocked/429/403 retailer responses must NEVER be fed back as a rotation signal.
  recordProbe(candidate, result, now) {
    checkTime(now)
    const state = this.entries.get(candidate)
    if (!state) throw new Error('Unknown proxy candidate')
    if (now < state.retryAfter) return false

    const healthy = result?.ownedEndpoint === true &&
      result?.ok === true &&
      Number.isFinite(result?.latencyMs) &&
      result.latencyMs >= 0 &&
      result.latencyMs <= this.maxLatencyMs

    if (healthy) {
      state.failures = 0
      state.retryAfter = 0
      state.healthyAt = now
      state.latencyMs = result.latencyMs
      return true
    }

    state.failures = Math.min(state.failures + 1, 16)
    state.healthyAt = null
    state.latencyMs = null
    const multiplier = 2 ** Math.min(state.failures - 1, 6)
    state.retryAfter = now + this.cooldownMs * multiplier
    return false
  }

  healthy(now) {
    checkTime(now)
    if (this.lastRefreshAt === null ||
      now - this.lastRefreshAt >= this.refreshIntervalMs * 2) return []
    return [...this.entries.entries()]
      .filter(([, value]) => value.healthyAt !== null &&
        now >= value.healthyAt &&
        now - value.healthyAt < this.healthyTtlMs &&
        now >= value.retryAfter)
      .sort((a, b) => a[1].latencyMs - b[1].latencyMs)
      .map(([candidate]) => candidate)
  }

  select(now) {
    // No stale or unchecked fallback; caller must never silently bypass policy.
    return this.healthy(now)[0] ?? null
  }

  summary(now) {
    return {
      candidates: this.entries.size,
      healthy: this.healthy(now).length,
      needingProbe: this.dueForProbe(now).length,
      lastRefreshAt: this.lastRefreshAt,
    }
  }
}
