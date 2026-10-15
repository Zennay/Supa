import { decodeHtmlEntities } from './extract.mjs'

export function sitemapLocs(xml) {
  const isIndex = /<sitemapindex\b/i.test(xml)
  const locs = [...String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) =>
    decodeHtmlEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')),
  )
  return { isIndex, locs }
}

// Walks a sitemap (index) and yields page URLs matching `accept`.
// `followIndex` decides which child sitemaps of an index are worth fetching.
export async function* walkSitemap(fetcher, url, { accept = () => true, followIndex = () => true } = {}) {
  const seen = new Set()
  const queue = [url]
  while (queue.length) {
    const next = queue.shift()
    if (seen.has(next)) continue
    seen.add(next)
    const xml = await fetcher.getText(next, { accept: 'application/xml,text/xml,*/*' })
    const { isIndex, locs } = sitemapLocs(xml)
    if (isIndex) {
      for (const loc of locs) if (followIndex(loc)) queue.push(loc)
    } else {
      for (const loc of locs) if (accept(loc)) yield loc
    }
  }
}
