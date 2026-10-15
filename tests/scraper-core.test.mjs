import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findAll, jsonLdProducts, nuxt2State, nuxtData, parseJsLiteral, resolveDevalue } from '../scraper/lib/extract.mjs'
import { HostBlockedError, PoliteFetcher, RobotsDisallowedError } from '../scraper/lib/http.mjs'
import { isGlobalGtin, nameTokens, normalizeGtin, packFromAmount, parsePack, toCents } from '../scraper/lib/normalize.mjs'
import { crawlDelaySeconds, isAllowed, parseRobots } from '../scraper/lib/robots.mjs'

// --- robots.txt -------------------------------------------------------------

test('robots: longest match wins, Allow wins ties, wildcards and $', () => {
  const robots = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /search
Disallow: /*?*sort=
Allow: /search/help$
Disallow: /private/
Crawl-delay: 2
`)
  const ua = 'SupaPriceBot/0.1'
  assert.equal(isAllowed(robots, ua, 'https://x.nl/product/1'), true)
  assert.equal(isAllowed(robots, ua, 'https://x.nl/search?q=melk'), false)
  assert.equal(isAllowed(robots, ua, 'https://x.nl/search/help'), true)
  assert.equal(isAllowed(robots, ua, 'https://x.nl/search/help/more'), false)
  assert.equal(isAllowed(robots, ua, 'https://x.nl/cat?page=2&sort=asc'), false)
  assert.equal(isAllowed(robots, ua, 'https://x.nl/private/a'), false)
  assert.equal(isAllowed(robots, 'Googlebot', 'https://x.nl/product/1'), false)
  assert.equal(crawlDelaySeconds(robots, ua), 2)
})

test('robots: repeated User-agent * groups are merged (DekaMarkt style)', () => {
  const robots = parseRobots(`User-agent: MJ12bot\nDisallow: /\nUser-agent: *\nDisallow: /misc/cookies\nUser-agent: *\nAllow: /\n`)
  assert.equal(isAllowed(robots, 'SupaPriceBot', '/misc/cookies'), false)
  assert.equal(isAllowed(robots, 'SupaPriceBot', '/producten/x/1'), true)
})

// --- normalisation ----------------------------------------------------------

test('toCents handles numbers, dot and comma decimals and rejects junk', () => {
  assert.equal(toCents(2.29), 229)
  assert.equal(toCents('2.69'), 269)
  assert.equal(toCents('€ 1,49'), 149)
  assert.equal(toCents('1.234,50'), 123450)
  assert.equal(toCents(0.1 + 0.2), 30)
  assert.equal(toCents('gratis'), null)
  assert.equal(toCents(-1), null)
  assert.equal(toCents(null), null)
})

test('parsePack converts Dutch pack texts to base units', () => {
  assert.deepEqual(parsePack('225 g'), { amount: 225, unit: 'g', count: 1 })
  assert.deepEqual(parsePack('6 x 200 ml'), { amount: 200, unit: 'ml', count: 6 })
  assert.deepEqual(parsePack('24x33cl'), { amount: 330, unit: 'ml', count: 24 })
  assert.deepEqual(parsePack('1,5 liter'), { amount: 1500, unit: 'ml', count: 1 })
  assert.deepEqual(parsePack('Per Tube 85 g'), { amount: 85, unit: 'g', count: 1 })
  assert.deepEqual(parsePack('1 kilo'), { amount: 1000, unit: 'g', count: 1 })
  assert.deepEqual(parsePack('10 stuks'), { amount: 1, unit: 'piece', count: 10 })
  assert.deepEqual(parsePack('Per stuk'), { amount: 1, unit: 'piece', count: 1 })
  assert.deepEqual(parsePack('Per set'), { amount: null, unit: null, count: 1 })
  assert.deepEqual(packFromAmount(7200, 'ML'), { amount: 7200, unit: 'ml', count: 1 })
  assert.deepEqual(packFromAmount('350', 'g'), { amount: 350, unit: 'g', count: 1 })
  assert.deepEqual(packFromAmount(6, 'H87'), { amount: 1, unit: 'piece', count: 6 })
})

test('GTIN validation, normalisation and in-store prefixes', () => {
  assert.equal(normalizeGtin('8711741337974'), '8711741337974')
  assert.equal(normalizeGtin('08711741337974'), '8711741337974')
  assert.equal(normalizeGtin('8711741337975'), null) // bad check digit
  assert.equal(normalizeGtin('123'), null)
  assert.equal(normalizeGtin('0000000000000'), null)
  assert.equal(isGlobalGtin('8711741337974'), true)
  assert.equal(isGlobalGtin('2140040000000'), false) // variable-weight / in-store
  assert.equal(isGlobalGtin('2339636000000'), false)
})

test('nameTokens drops brand, pack sizes and filler words', () => {
  assert.deepEqual(nameTokens('Calvé 100% Pindakaas 350 g pot', 'Calve'), ['pindakaas'])
  assert.deepEqual(nameTokens('Heineken Pilsener Krat 24 x 300 ml', 'Heineken'), ['pilsener'])
})

// --- extraction -----------------------------------------------------------

test('JSON-LD Product found inside @graph', () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"Product","name":"A"}]}</script>`
  assert.deepEqual(jsonLdProducts(html).map((p) => p.name), ['A'])
})

test('devalue payload resolution (Nuxt 3) incl. Reactive wrappers and shared refs', () => {
  const table = [['Reactive', 1], { data: 2 }, { 'product-1': 3 }, { productId: 4, name: 5, tags: 6 }, 1, 'Melk', [5, 5]]
  const root = resolveDevalue(table)
  assert.deepEqual(root.data['product-1'], { productId: 1, name: 'Melk', tags: ['Melk', 'Melk'] })
  const html = `<script type="application/json" id="__NUXT_DATA__" data-ssr="true">${JSON.stringify(table)}</script>`
  assert.equal(nuxtData(html).data['product-1'].name, 'Melk')
})

test('Nuxt 2 IIFE payload is resolved without evaluating JavaScript', () => {
  const html = `<script>window.__NUXT__=(function(a,b,c,d){a[0]="x";return {data:[{productDetails:{articleNumber:12,description:"Pindakaas \\u0026 jam",unit:b,contents:c,price:2.79,inWebshop:d,eans:[c,"8"],skip:new Date(1),v:void 0}}]}}([],"gram","350",true));</script>`
  const state = nuxt2State(html)
  const [p] = findAll(state, (o) => 'articleNumber' in o)
  assert.deepEqual(
    { ...p, skip: undefined, v: undefined },
    { articleNumber: 12, description: 'Pindakaas & jam', unit: 'gram', contents: '350', price: 2.79, inWebshop: true, eans: ['350', '8'], skip: undefined, v: undefined },
  )
  assert.deepEqual(parseJsLiteral(`{a:1,'b':[x,-2.5e1],c:!0}`, { x: 'y' }), { a: 1, b: ['y', -25], c: true })
})

// --- polite fetcher -------------------------------------------------------

function fakeFetch(routes, log = []) {
  return async (url) => {
    log.push(url)
    const route = routes[url] ?? routes['*']
    const r = typeof route === 'function' ? route(url) : route
    if (!r) return new Response('nope', { status: 404 })
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? {} })
  }
}

const fastSleep = async () => {}

test('fetcher obeys robots.txt and paces requests per host', async () => {
  const log = []
  let clock = 0
  const sleeps = []
  const fetcher = new PoliteFetcher({
    minDelayMs: 1000,
    fetchImpl: fakeFetch(
      {
        'https://shop.nl/robots.txt': { body: 'User-agent: *\nDisallow: /cart\nCrawl-delay: 3' },
        '*': { body: '<html>ok</html>' },
      },
      log,
    ),
    sleepImpl: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    now: () => clock,
  })
  assert.equal(await fetcher.getText('https://shop.nl/p/1'), '<html>ok</html>')
  await fetcher.getText('https://shop.nl/p/2')
  await assert.rejects(fetcher.getText('https://shop.nl/cart'), RobotsDisallowedError)
  assert.deepEqual(log, ['https://shop.nl/robots.txt', 'https://shop.nl/p/1', 'https://shop.nl/p/2'])
  assert.ok(sleeps.includes(3000), `crawl-delay respected: ${sleeps}`)
})

test('fetcher stops for good on 403 (no evasion) and treats 404 robots as allow-all', async () => {
  const log = []
  const fetcher = new PoliteFetcher({
    minDelayMs: 0,
    sleepImpl: fastSleep,
    fetchImpl: fakeFetch({ 'https://blocked.nl/robots.txt': { status: 403 }, 'https://open.nl/p': { body: 'x' } }, log),
  })
  await assert.rejects(fetcher.getText('https://blocked.nl/p/1'), HostBlockedError)
  await assert.rejects(fetcher.getText('https://blocked.nl/p/2'), HostBlockedError)
  assert.equal(log.filter((u) => u.startsWith('https://blocked.nl')).length, 1)
  assert.equal(await fetcher.getText('https://open.nl/p'), 'x')
})

test('fetcher retries 5xx with backoff, then gives up; 429 twice more => blocked', async () => {
  let calls = 0
  const fetcher = new PoliteFetcher({
    minDelayMs: 0,
    retries: 2,
    sleepImpl: fastSleep,
    fetchImpl: fakeFetch({
      'https://a.nl/robots.txt': { status: 404 },
      'https://a.nl/flaky': () => (++calls < 3 ? { status: 503 } : { body: 'fine' }),
      'https://a.nl/slow': { status: 429, headers: { 'retry-after': '1' } },
    }),
  })
  assert.equal(await fetcher.getText('https://a.nl/flaky'), 'fine')
  assert.equal(calls, 3)
  await assert.rejects(fetcher.getText('https://a.nl/slow'), HostBlockedError)
})
