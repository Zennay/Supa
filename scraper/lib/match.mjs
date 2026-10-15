// Cross-retailer product matching.
//
// 1. Exact: products sharing a global GTIN/EAN are the same article.
// 2. Conservative fuzzy: a product without a usable GTIN joins a cluster only
//    if the brand is identical, the total pack quantity is identical (±1%),
//    the cluster has no product from that retailer yet, and name tokens are
//    similar enough with a clear winner. Otherwise it stays on its own:
//    a missed match is cheaper than a wrong price comparison.
import { foldText, isGlobalGtin, nameTokens } from './normalize.mjs'

export const FUZZY_MIN_SCORE = 0.6
export const FUZZY_MIN_MARGIN = 0.1

class UnionFind {
  constructor() {
    this.parent = new Map()
  }
  find(x) {
    let p = this.parent.get(x) ?? x
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

export function dice(a, b) {
  if (!a.length || !b.length) return 0
  const setB = new Set(b)
  const setA = new Set(a)
  let common = 0
  for (const t of setA) if (setB.has(t)) common += 1
  return (2 * common) / (setA.size + setB.size)
}

function packKey(p) {
  if (p.pack_amount === null || p.pack_amount === undefined || !p.pack_unit) return null
  const total = p.pack_amount * (p.pack_count || 1)
  return { unit: p.pack_unit, total }
}

function samePack(a, b) {
  if (!a || !b || a.unit !== b.unit) return false
  return Math.abs(a.total - b.total) <= Math.max(a.total, b.total) * 0.01
}

// products: [{ id, retailer_id, name, brand, gtins: string[], pack_amount, pack_unit, pack_count }]
export function matchProducts(products) {
  const uf = new UnionFind()
  const byGtin = new Map()
  for (const p of products) {
    uf.find(p.id)
    for (const gtin of p.gtins ?? []) {
      if (!isGlobalGtin(gtin)) continue
      if (byGtin.has(gtin)) uf.union(byGtin.get(gtin), p.id)
      else byGtin.set(gtin, p.id)
    }
  }

  const method = new Map()
  const score = new Map()
  for (const p of products) {
    if ((p.gtins ?? []).some(isGlobalGtin)) {
      method.set(p.id, 'gtin')
      score.set(p.id, 1)
    }
  }

  // Build cluster index for fuzzy attachment.
  const clusters = new Map()
  const prepared = new Map()
  for (const p of products) {
    const info = {
      ...p,
      brandKey: foldText(p.brand),
      tokens: nameTokens(p.name, p.brand),
      pack: packKey(p),
    }
    prepared.set(p.id, info)
    const root = uf.find(p.id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(info)
  }

  const blockKey = (info) =>
    info.brandKey && info.pack
      ? `${info.brandKey}|${info.pack.unit}|${Math.round(info.pack.total)}`
      : null
  const blocks = new Map()
  const addToBlock = (info, root) => {
    const key = blockKey(info)
    if (!key) return
    if (!blocks.has(key)) blocks.set(key, new Set())
    blocks.get(key).add(root)
  }
  for (const [root, members] of clusters) for (const m of members) addToBlock(m, root)

  const pending = products
    .filter((p) => !method.has(p.id))
    .map((p) => prepared.get(p.id))
    .sort((a, b) => a.id - b.id)

  for (const info of pending) {
    const key = blockKey(info)
    if (!key || !info.tokens.length) continue
    const ownRoot = uf.find(info.id)
    const ownRetailers = new Set((clusters.get(ownRoot) ?? [info]).map((m) => m.retailer_id))
    const candidates = []
    for (const root of blocks.get(key) ?? []) {
      const r = uf.find(root)
      if (r === ownRoot) continue
      const members = clusters.get(r) ?? []
      if (members.some((m) => ownRetailers.has(m.retailer_id))) continue
      let best = 0
      for (const m of members) {
        if (m.brandKey !== info.brandKey || !samePack(m.pack, info.pack)) continue
        best = Math.max(best, dice(info.tokens, m.tokens))
      }
      if (best > 0) candidates.push({ root: r, score: best })
    }
    candidates.sort((a, b) => b.score - a.score)
    const [top, runnerUp] = candidates
    if (!top || top.score < FUZZY_MIN_SCORE) continue
    if (runnerUp && top.score - runnerUp.score < FUZZY_MIN_MARGIN) continue

    const merged = [...(clusters.get(top.root) ?? []), ...(clusters.get(ownRoot) ?? [])]
    clusters.delete(ownRoot)
    uf.union(top.root, info.id)
    const newRoot = uf.find(top.root)
    clusters.delete(top.root)
    clusters.set(newRoot, merged)
    addToBlock(info, newRoot)
    method.set(info.id, 'brand-name-pack')
    score.set(info.id, Math.round(top.score * 1000) / 1000)
  }

  const groups = new Map()
  for (const p of products) {
    const root = uf.find(p.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(p)
  }

  return [...groups.values()].map((members) => {
    const ranked = [...members].sort(
      (a, b) =>
        (b.gtins?.some(isGlobalGtin) ? 1 : 0) - (a.gtins?.some(isGlobalGtin) ? 1 : 0) ||
        (b.brand ? 1 : 0) - (a.brand ? 1 : 0) ||
        a.id - b.id,
    )
    const rep = ranked[0]
    const gtin = rep.gtins?.find(isGlobalGtin) ?? null
    return {
      canonical: {
        gtin,
        name: rep.name,
        brand: rep.brand ?? null,
        pack_amount: rep.pack_amount ?? null,
        pack_unit: rep.pack_unit ?? null,
        pack_count: rep.pack_count ?? null,
        category: rep.category ?? null,
      },
      members: members.map((m) => ({
        productId: m.id,
        method: members.length === 1 ? 'single' : method.get(m.id) ?? 'brand-name-pack',
        score: members.length === 1 ? 1 : score.get(m.id) ?? 1,
      })),
    }
  })
}

// Recompute canonical products + matches inside the database.
export function rebuildMatches(store, { at = new Date().toISOString() } = {}) {
  const rows = store.all(`
    SELECT p.id, p.retailer_id, p.name, p.brand, p.category, p.pack_amount, p.pack_unit,
           p.pack_count, group_concat(g.gtin) AS gtins
    FROM products p LEFT JOIN product_gtins g ON g.product_id = p.id
    GROUP BY p.id`)
  const products = rows.map((r) => ({
    ...r,
    id: Number(r.id),
    gtins: r.gtins ? String(r.gtins).split(',') : [],
  }))
  const groups = matchProducts(products)
  const retailerOf = new Map(products.map((p) => [p.id, p.retailer_id]))

  const db = store.db
  const insertCanonical = db.prepare(`
    INSERT INTO canonical_products(gtin, name, brand, pack_amount, pack_unit, pack_count, category)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
  const insertMatch = db.prepare(`
    INSERT INTO product_matches(product_id, canonical_id, method, score, matched_at)
    VALUES (?, ?, ?, ?, ?)`)

  const summary = { canonical: 0, multiRetailer: 0, gtin: 0, fuzzy: 0, single: 0 }
  store.transaction(() => {
    db.exec('DELETE FROM product_matches; DELETE FROM canonical_products;')
    for (const group of groups) {
      const c = group.canonical
      const { id } = insertCanonical.get(
        c.gtin,
        c.name,
        c.brand,
        c.pack_amount,
        c.pack_unit,
        c.pack_count,
        c.category,
      )
      summary.canonical += 1
      const retailers = new Set(group.members.map((m) => retailerOf.get(m.productId)))
      if (retailers.size > 1) summary.multiRetailer += 1
      for (const m of group.members) {
        insertMatch.run(m.productId, id, m.method, m.score, at)
        if (m.method === 'gtin') summary.gtin += 1
        else if (m.method === 'single') summary.single += 1
        else summary.fuzzy += 1
      }
    }
  })
  return summary
}
