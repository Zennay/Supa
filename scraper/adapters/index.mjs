import { aldi } from './aldi.mjs'
import { dekamarkt, dirk } from './detailresult.mjs'
import { hoogvliet } from './hoogvliet.mjs'
import { lidl } from './lidl.mjs'
import { plus } from './plus.mjs'
import { poiesz } from './poiesz.mjs'
import { parseSchemaOrgPage } from './schemaorg.mjs'
import { spar } from './spar.mjs'
import { vomar } from './vomar.mjs'

// Retailers whose sites refuse automated access from our network. They get a
// generic JSON-LD adapter so a run from an allowed network works, but the
// fetcher stops at the first 401/403/timeout: we never try to get around a
// bot wall.
function blockedJsonLd({ id, name, host, notes, sitemap, accept }) {
  return {
    id,
    name,
    host,
    status: 'blocked',
    mode: 'http',
    notes,
    async *discover({ fetcher }) {
      const { walkSitemap } = await import('../lib/sitemap.mjs')
      for await (const url of walkSitemap(fetcher, sitemap, { accept })) {
        yield { url, kind: 'product' }
      }
    },
    parse: (html, url) => parseSchemaOrgPage(html, url, { retailer: id }),
  }
}

export const ah = blockedJsonLd({
  id: 'ah',
  name: 'Albert Heijn',
  host: 'www.ah.nl',
  notes: 'Akamai bot protection: HTTP 403 on every request incl. robots.txt (2026-10-15)',
  sitemap: 'https://www.ah.nl/sitemaps/entities/products/detail.xml',
  accept: (u) => /\/producten\/product\//.test(u),
})

export const jumbo = blockedJsonLd({
  id: 'jumbo',
  name: 'Jumbo',
  host: 'www.jumbo.com',
  notes: 'Connection accepted but no response (bot protection tarpit) (2026-10-15)',
  sitemap: 'https://www.jumbo.com/sitemap.xml',
  accept: (u) => /\/producten\/[^/]+-\d+[A-Z]+/.test(u),
})

export const janlinders = blockedJsonLd({
  id: 'janlinders',
  name: 'Jan Linders',
  host: 'www.janlinders.nl',
  notes: 'HTTP 403 on every request incl. robots.txt (2026-10-15)',
  sitemap: 'https://www.janlinders.nl/sitemap.xml',
  accept: () => true,
})

// Chains without a scrapeable online assortment with prices.
export const unsupported = [
  { id: 'picnic', name: 'Picnic', host: 'picnic.app', status: 'unsupported', notes: 'App-only assortment; no public web catalogue' },
  { id: 'boni', name: 'Boni', host: 'boni.nl', status: 'unsupported', notes: 'WordPress site with folders only; no product catalogue' },
  { id: 'nettorama', name: 'Nettorama', host: 'www.nettorama.nl', status: 'unsupported', notes: 'No online product catalogue (sitemap HTTP 500)' },
  { id: 'coop', name: 'Coop', host: 'www.coop.nl', status: 'unsupported', notes: 'Merged into PLUS; coop.nl redirects to plus.nl' },
]

export const adapters = [plus, dirk, dekamarkt, spar, hoogvliet, aldi, lidl, poiesz, vomar, ah, jumbo, janlinders]

export function getAdapter(id) {
  return adapters.find((a) => a.id === id)
}
