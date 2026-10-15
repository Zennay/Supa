// Hoogvliet: Next.js (Magento GraphQL data) + JSON-LD. JSON-LD carries the
// price; the Next payload's product `metadata` JSON carries EAN, brand (merk),
// content (inhoud_ce) and its unit (eenheid).
import { findAll, nextData } from '../lib/extract.mjs'
import { walkSitemap } from '../lib/sitemap.mjs'
import { packFromAmount } from '../lib/normalize.mjs'
import { parseSchemaOrgPage } from './schemaorg.mjs'

const UNIT = { gram: 'g', kilogram: 'kg', milliliter: 'ml', liter: 'l', stuks: 'st', stuk: 'st' }

export function parseHoogvliet(html, url) {
  const records = parseSchemaOrgPage(html, url, { retailer: 'hoogvliet' })
  if (!records.length) return records
  const next = nextData(html)
  const record = records[0]
  const product = next
    ? findAll(next, (o) => o.sku === record.sourceId && typeof o.metadata === 'string', 1)[0]
    : null
  if (!product) return records

  let meta = {}
  try {
    meta = JSON.parse(product.metadata)
  } catch {
    // keep JSON-LD only
  }
  const unit = UNIT[String(meta.eenheid ?? '').toLowerCase()]
  const pack = packFromAmount(meta.inhoud_ce, unit)
  const category = (product.categories ?? [])
    .slice()
    .sort((a, b) => a.level - b.level)
    .map((c) => c.name)
    .join(' > ')
  return [
    {
      ...record,
      brand: meta.merk ?? record.brand,
      gtin: record.gtin ?? null,
      category: category || record.category,
      packText: meta.inhoud_ce && meta.eenheid ? `${meta.inhoud_ce} ${meta.eenheid}` : record.packText,
      packAmount: pack.amount ?? record.packAmount,
      packUnit: pack.unit ?? record.packUnit,
      packCount: pack.amount !== null ? pack.count : record.packCount,
      availability:
        product.stock_status === 'IN_STOCK'
          ? 'available'
          : product.stock_status === 'OUT_OF_STOCK'
            ? 'unavailable'
            : record.availability,
    },
  ]
}

export const hoogvliet = {
  id: 'hoogvliet',
  name: 'Hoogvliet',
  host: 'hoogvliet.nl',
  status: 'active',
  mode: 'http',
  notes: 'JSON-LD + Next.js metadata (EAN, inhoud); catalog sitemap',
  async *discover({ fetcher }) {
    for await (const url of walkSitemap(fetcher, 'https://hoogvliet.nl/sitemap-catalog.xml', {
      // Product URLs end in the 9-digit article number; categories don't.
      accept: (u) => /^https:\/\/hoogvliet\.nl\/[^/]+-\d{6,}$/.test(u),
    })) {
      yield { url: url.replace('https://hoogvliet.nl/', 'https://hoogvliet.nl/product/'), kind: 'product' }
    }
  },
  parse: parseHoogvliet,
}
