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
    const { origin, host } = new URL(url)
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
      const wait = state.nextAt - this.now()
      if (wait > 0) await this.sleep(wait)
      try {
        return await task()
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
    const { host } = new URL(url)
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
    const origin = new URL(url)
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
          const retryAfter = Number(res.headers.get('retry-after'))
          if (Number.isFinite(retryAfter)) error.retryAfter = retryAfter
          try {
            await res.body?.cancel()
          } catch {
            // ignore
          }
          throw error
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.length > this.maxBytes) {
          throw new Error('retailer HTTP response exceeds maximum bytes')
        }
        const bytes =
          buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer
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
