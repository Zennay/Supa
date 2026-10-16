// Polite HTTP client for retailer scraping.
//
// - identifies itself honestly (no browser UA spoofing)
// - fetches and obeys robots.txt per host (incl. Crawl-delay)
// - serialises requests per host with a minimum delay between them
// - retries network errors / 5xx with exponential backoff
// - opens a per-host circuit on 401/403 or repeated 429: we stop, we never
//   try to get around a block (no proxy rotation, no CAPTCHA handling)
import { gunzipSync } from 'node:zlib'
import { crawlDelaySeconds, isAllowed, parseRobots } from './robots.mjs'

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; SupaPriceBot/0.1; +https://github.com/Zennay/Supa)'

export class RobotsDisallowedError extends Error {
  constructor(url) {
    super(`robots.txt disallows ${url}`)
    this.name = 'RobotsDisallowedError'
    this.url = url
  }
}

export class HostBlockedError extends Error {
  constructor(host, reason) {
    super(`host ${host} blocked: ${reason}`)
    this.name = 'HostBlockedError'
    this.host = host
    this.reason = reason
  }
}

export class HttpStatusError extends Error {
  constructor(url, status) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpStatusError'
    this.url = url
    this.status = status
  }
}

// Reject unsafe initial transport targets BEFORE robots.txt or any HTTP I/O.
// WHATWG URL canonicalises disguised numeric IPv4 spellings into dot-decimal.
// A caller's retailer policy is a separate, stricter admission gate.
function assertPublicHttpsTarget(value) {
  let parsed
  try { parsed = new URL(value) } catch {
    throw new Error('retailer HTTP unsafe retailer target: not an approved HTTPS origin')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  const forbidden = parsed.protocol !== 'https:' || !!parsed.port ||
    !!parsed.username || !!parsed.password || !hostname ||
    hostname.startsWith('[') ||
    /^\d+(?:\.\d+){3}$/.test(hostname) ||
    /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/.test(hostname)
  if (forbidden) {
    throw new Error('retailer HTTP unsafe retailer target: not an approved HTTPS origin')
  }
  return parsed
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class PoliteFetcher {
  constructor({
    userAgent = DEFAULT_USER_AGENT,
    minDelayMs = 1000,
    timeoutMs = 30_000,
    maxBytes = 8 * 1024 * 1024,
    retries = 3,
    respectRobots = true,
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
    now = () => Date.now(),
  } = {}) {
    this.userAgent = userAgent
    this.minDelayMs = minDelayMs
    this.timeoutMs = timeoutMs
    this.maxBytes = maxBytes
    this.retries = retries
    this.respectRobots = respectRobots
    this.fetchImpl = fetchImpl
    this.sleep = sleepImpl
    this.now = now
    this.hosts = new Map()
    this.stats = { requests: 0, bytes: 0, errors: 0 }
  }

  hostState(host) {
    let state = this.hosts.get(host)
    if (!state) {
      state = {
        robots: undefined,
        robotsPromise: null,
        blocked: null,
        nextAt: 0,
        chain: Promise.resolve(),
        throttled: 0,
      }
      this.hosts.set(host, state)
    }
    return state
  }

  isBlocked(host) {
    return this.hostState(host).blocked
  }

  async robotsFor(url) {
    const { origin, host } = assertPublicHttpsTarget(url)
    const state = this.hostState(host)
    if (state.robots !== undefined) return state.robots
    if (!state.robotsPromise) {
      state.robotsPromise = (async () => {
        let res
        try {
          res = await this.request(`${origin}/robots.txt`, { skipRobots: true })
        } catch (error) {
          if (error instanceof HostBlockedError) throw error
          if (error instanceof HttpStatusError && error.status < 500) {
            // RFC 9309: robots.txt unavailable (4xx) => no restrictions.
            state.robots = null
            return null
          }
          // Unreachable robots.txt: be conservative and treat the host as closed.
          state.blocked = `robots.txt unreachable (${error.message})`
          throw new HostBlockedError(host, state.blocked)
        }
        state.robots = parseRobots(res.text)
        return state.robots
      })()
    }
    return state.robotsPromise
  }

  // Serialise per host and wait out the politeness delay.
  async schedule(host, task) {
    const state = this.hostState(host)
    const run = state.chain.then(async () => {
      // A queued task can outlive an earlier 401/403 response that blocks
      // this retailer. Re-check the circuit after the host queue *and* any
      // politeness sleep, immediately before entering the HTTP transport.
      if (state.blocked) throw new HostBlockedError(host, state.blocked)
      const wait = state.nextAt - this.now()
      if (wait > 0) await this.sleep(wait)
      if (state.blocked) throw new HostBlockedError(host, state.blocked)
      try {
        return await task()
      } catch (error) {
        // Trip the host circuit *inside* the serial scheduler. If deferred to
        // request()'s outer catch, a queued task can enter the HTTP transport
        // between this rejected task settling and the 401/403 block update.
        if (error instanceof HttpStatusError && (error.status === 401 || error.status === 403)) {
          state.blocked = `HTTP ${error.status}`
        }
        throw error
      } finally {
        const crawlDelay = state.robots
          ? crawlDelaySeconds(state.robots, this.userAgent)
          : null
        const delay = Math.max(this.minDelayMs, (crawlDelay ?? 0) * 1000)
        state.nextAt = this.now() + delay
      }
    })
    state.chain = run.catch(() => {})
    return run
  }

  async request(url, { skipRobots = false, accept, method = 'GET', body, headers = {} } = {}) {
    const { host } = assertPublicHttpsTarget(url)
    const state = this.hostState(host)
    if (state.blocked) throw new HostBlockedError(host, state.blocked)

    if (!skipRobots && this.respectRobots) {
      const robots = await this.robotsFor(url)
      if (!isAllowed(robots, this.userAgent, url)) throw new RobotsDisallowedError(url)
    }

    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        return await this.schedule(host, () =>
          this.once(url, { accept, method, body, headers, skipRobots }),
        )
      } catch (error) {
        if (error instanceof HttpStatusError) {
          if (error.status === 401 || error.status === 403) {
            state.blocked = `HTTP ${error.status}`
            throw new HostBlockedError(host, state.blocked)
          }
          if (error.status === 429) {
            state.throttled += 1
            if (state.throttled > 2) {
              state.blocked = 'HTTP 429 (rate limited)'
              throw new HostBlockedError(host, state.blocked)
            }
            await this.sleep(Math.min(120_000, (error.retryAfter ?? 30) * 1000))
            continue
          }
          if (error.status < 500 || attempt > this.retries) throw error
        } else if (attempt > this.retries) {
          this.stats.errors += 1
          throw error
        }
        await this.sleep(1000 * 2 ** attempt)
      }
    }
  }

  async once(url, { accept, method, body, headers, skipRobots = false }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const origin = assertPublicHttpsTarget(url)
    // Never let a per-source approval silently become a browser-like redirect
    // permission. Absolute HTTPS, one exact host, no userinfo/custom port.
    const approved = (candidate) => candidate.protocol === 'https:' &&
      candidate.hostname === origin.hostname &&
      candidate.port === origin.port &&
      candidate.username === '' && candidate.password === ''
    if (!approved(origin)) {
      clearTimeout(timer)
      throw new Error('retailer HTTP source is not an approved HTTPS origin')
    }

    const seen = new Set()
    let current = origin.href
    try {
      for (let hop = 0; hop <= 5; hop += 1) {
        if (seen.has(current)) throw new Error('retailer HTTP redirect loop refused')
        seen.add(current)
        this.stats.requests += 1
        const res = await this.fetchImpl(current, {
          method,
          body,
          // A default fetch redirect follows a foreign Location *before*
          // scope/robots/pacing can be rechecked. Manual redirects are mandatory.
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': this.userAgent,
            accept: accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'nl-NL,nl;q=0.9,en;q=0.5',
            ...headers,
          },
        })
        const final = new URL(res.url || current)
        if (!approved(final)) {
          await res.body?.cancel()
          throw new Error('retailer HTTP redirected outside approved HTTPS origin')
        }

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location')
          // Do not forward authenticated or POST requests on redirect.
          if (!location || (method !== 'GET' && method !== 'HEAD') || hop === 5) {
            await res.body?.cancel()
            throw new Error('retailer HTTP redirect refused (missing target, unsafe method or hop limit)')
          }
          let target
          try {
            target = new URL(location, final)
          } catch {
            await res.body?.cancel()
            throw new Error('retailer HTTP redirect target is malformed')
          }
          if (!approved(target)) {
            await res.body?.cancel()
            throw new Error('retailer HTTP redirect target is not an approved HTTPS origin')
          }
          // The initial robots.txt check is NOT enough for a redirected path.
          if (!skipRobots && this.respectRobots &&
              !isAllowed(this.hostState(origin.host).robots, this.userAgent, target.href)) {
            await res.body?.cancel()
            throw new RobotsDisallowedError(target.href)
          }
          await res.body?.cancel()
          const robots = this.hostState(origin.host).robots
          await this.sleep(Math.max(
            this.minDelayMs,
            (crawlDelaySeconds(robots, this.userAgent) ?? 0) * 1000,
          ))
          current = target.href
          continue
        }

        if (!res.ok) {
          const error = new HttpStatusError(current, res.status)
          // Missing Retry-After is null; Number(null) === 0 is NOT a
          // server-requested zero-second cooldown. Never honour negative or
          // nonfinite values as delays; the caller's 30s fallback applies.
          const retryHeader = res.headers.get('retry-after')
          let retryAfter = NaN
          if (typeof retryHeader === 'string' && retryHeader.trim()) {
            const header = retryHeader.trim()
            // Preserve existing numeric delay-seconds semantics. An HTTP-date
            // expresses an absolute deadline and must use the injected clock.
            retryAfter = Number(header)
            if (!Number.isFinite(retryAfter)) {
              const at = Date.parse(header)
              // Date.parse alone admits non-HTTP dates and normalized invalid
              // dates. Require canonical IMF-fixdate before trusting a deadline.
              if (Number.isFinite(at) && new Date(at).toUTCString() === header &&
                  at > this.now()) {
                retryAfter = Math.ceil((at - this.now()) / 1000)
              }
            }
          }
          if (Number.isFinite(retryAfter) && retryAfter >= 0) error.retryAfter = retryAfter
          try {
            await res.body?.cancel()
          } catch {
            // ignore
          }
          throw error
        }
        // Native WHATWG response bodies must be counted as they arrive.
        // arrayBuffer() first would allocate the entire remote response before
        // enforcing the source budget; refusing afterwards is too late.
        let buffer
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader()
          const chunks = []
          let total = 0
          let finished = false
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) {
                finished = true
                break
              }
              const chunk = Buffer.from(value)
              total += chunk.byteLength
              if (total > this.maxBytes) {
                await reader.cancel()
                throw new Error('retailer HTTP response exceeds maximum bytes')
              }
              chunks.push(chunk)
            }
            buffer = Buffer.concat(chunks, total)
          } finally {
            // Release the reader on success; cancel unread network input on
            // read errors too. The explicit over-budget cancellation above
            // immediately stops production even with a slow remote stream.
            if (!finished) {
              try { await reader.cancel() } catch { /* already closed */ }
            }
            reader.releaseLock()
          }
        } else {
          // Legacy injected transports without a WHATWG body are retained for
          // deterministic existing tests; real fetch Responses expose a stream.
          buffer = Buffer.from(await res.arrayBuffer())
          if (buffer.length > this.maxBytes) {
            throw new Error('retailer HTTP response exceeds maximum bytes')
          }
        }
        let bytes = buffer
        if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
          // Bound decompression itself, not only the wire payload. Otherwise
          // even a tiny valid gzip can allocate a huge HTML document.
          try {
            bytes = gunzipSync(buffer, { maxOutputLength: this.maxBytes })
          } catch (error) {
            if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
              throw new Error('retailer HTTP decoded response exceeds maximum bytes')
            }
            throw error
          }
        }
        this.stats.bytes += buffer.length
        return {
          url: final.href,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          text: bytes.toString('utf8'),
        }
      }
      throw new Error('retailer HTTP redirect hop limit reached')
    } finally {
      clearTimeout(timer)
    }
  }

  async getText(url, options) {
    return (await this.request(url, options)).text
  }
}
