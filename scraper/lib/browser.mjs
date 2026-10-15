// Headless Chromium renderer for single-page-app retailers (PLUS).
// Playwright is optional: it is resolved from the project, then from the
// global npm root, so the rest of the scraper works without it.
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HostBlockedError, RobotsDisallowedError } from './http.mjs'
import { isAllowed } from './robots.mjs'

async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
    return import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href)
  }
}

export class BrowserRenderer {
  constructor(fetcher, { timeoutMs = 45_000, executablePath = process.env.SUPA_CHROMIUM_PATH } = {}) {
    this.fetcher = fetcher
    this.timeoutMs = timeoutMs
    this.executablePath = executablePath
    this.browser = null
    this.contexts = new Map()
    this.idle = new Map()
  }

  async context(host) {
    if (!this.browser) {
      this.browserPromise ??= loadPlaywright().then(({ chromium }) =>
        chromium.launch(this.executablePath ? { executablePath: this.executablePath } : {}),
      )
      this.browser = await this.browserPromise
    }
    let contextPromise = this.contexts.get(host)
    if (!contextPromise) {
      contextPromise = (async () => {
        const context = await this.browser.newContext({
          userAgent: this.fetcher.userAgent,
          locale: 'nl-NL',
        })
        const siteDomain = host.split('.').slice(-2).join('.')
        await context.route('**/*', (route) => {
          const req = route.request()
          let reqHost = ''
          try {
            reqHost = new URL(req.url()).hostname
          } catch {
            // data: urls etc.
          }
          const firstParty = reqHost === siteDomain || reqHost.endsWith('.' + siteDomain)
          if (['image', 'media', 'font'].includes(req.resourceType()) || !firstParty) {
            return route.abort()
          }
          return route.continue()
        })
        return context
      })()
      this.contexts.set(host, contextPromise)
    }
    return contextPromise
  }

  // One tab per concurrent render; tabs are reused.
  async acquire(host) {
    const pool = this.idle.get(host) ?? []
    this.idle.set(host, pool)
    return pool.pop() ?? (await this.context(host)).newPage()
  }

  release(host, page) {
    this.idle.get(host).push(page)
  }

  async render(url, { readyCheck = () => true } = {}) {
    const { host } = new URL(url)
    const robots = await this.fetcher.robotsFor(url)
    if (this.fetcher.respectRobots && !isAllowed(robots, this.fetcher.userAgent, url)) {
      throw new RobotsDisallowedError(url)
    }
    const blocked = this.fetcher.isBlocked(host)
    if (blocked) throw new HostBlockedError(host, blocked)

    // Pace navigation starts per host; renders themselves may overlap.
    await this.fetcher.schedule(host, async () => {})
    const page = await this.acquire(host)
    try {
      this.fetcher.stats.requests += 1
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs })
      const status = response?.status() ?? 0
      if (status === 401 || status === 403 || status === 429) {
        this.fetcher.hostState(host).blocked = `HTTP ${status} (browser)`
        throw new HostBlockedError(host, `HTTP ${status}`)
      }
      const deadline = Date.now() + this.timeoutMs
      let html = await page.content()
      while (!readyCheck(html) && Date.now() < deadline) {
        await page.waitForTimeout(500)
        html = await page.content()
      }
      return { url: page.url(), status, text: html }
    } finally {
      this.release(host, page)
    }
  }

  async close() {
    await this.browser?.close()
    this.browser = null
    this.browserPromise = null
    this.contexts.clear()
    this.idle.clear()
  }
}
