// Vomar: Nuxt 2 site. Every subgroup listing (/producten/<dept>/<group>)
// embeds all its products in window.__NUXT__ (articleNumber, description,
// brand, contents + unit, price, primaryEan, additionalEans). We parse that
// literal payload without executing any retailer JavaScript.
import { findAll, nuxt2State } from '../lib/extract.mjs'
import { makeRecord, packFromAmount, toCents } from '../lib/normalize.mjs'

const BASE = 'https://www.vomar.nl'

const UNIT = { gram: 'g', kilogram: 'kg', kilo: 'kg', milliliter: 'ml', liter: 'l', stuk: 'st', stuks: 'st', cl: 'cl' }

export function parseVomar(html, url) {
  const state = nuxt2State(html)
  if (!state) return []
  const hrefs = new Map()
  for (const m of html.matchAll(/href="(\/producten\/[^"]+\/(\d+))"/g)) hrefs.set(m[2], m[1])

  const seen = new Map()
  for (const p of findAll(state, (o) => typeof o.articleNumber === 'number' && 'price' in o)) {
    const id = String(p.articleNumber)
    if (seen.has(id)) continue
    const unit = UNIT[String(p.unit ?? '').toLowerCase()] ?? p.unit
    const pack = packFromAmount(p.contents, unit)
    seen.set(
      id,
      makeRecord({
        retailer: 'vomar',
        sourceId: id,
        url: hrefs.has(id) ? BASE + hrefs.get(id) : url,
        name: p.description,
        brand: p.brand,
        gtin: p.primaryEan,
        extraGtins: p.additionalEans ?? [],
        packText: p.contents && p.unit ? `${p.contents} ${p.unit}` : null,
        pack: pack.amount !== null ? pack : undefined,
        imageUrl: p.images?.[0]?.fileName
          ? `https://d3vricquk1sjgf.cloudfront.net/${p.images[0].fileName}`
          : null,
        priceCents: toCents(p.price),
        availability: p.inWebshop === false ? 'unknown' : 'available',
      }),
    )
  }
  return [...seen.values()]
}

export function vomarLinks(html, depth) {
  const out = new Set()
  for (const m of html.matchAll(/href="(\/producten\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)"/g)) {
    const parts = m[1].split('/').filter(Boolean)
    if (parts.length === depth + 1) out.add(BASE + m[1])
  }
  return [...out]
}

export const vomar = {
  id: 'vomar',
  name: 'Vomar',
  host: 'www.vomar.nl',
  status: 'active',
  mode: 'http',
  notes: 'Nuxt 2 listing payload (department > group crawl)',
  async *discover({ fetcher }) {
    const root = await fetcher.getText(`${BASE}/producten`)
    const groups = new Set()
    for (const dept of vomarLinks(root, 1)) {
      const html = await fetcher.getText(dept)
      for (const group of vomarLinks(html, 2)) {
        if (!groups.has(group)) {
          groups.add(group)
          yield { url: group, kind: 'listing' }
        }
      }
    }
  },
  parse: parseVomar,
}
