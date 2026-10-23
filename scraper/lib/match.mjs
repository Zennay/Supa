// Cross-retailer product matching.
//
// 1. Exact: products sharing a global GTIN/EAN are the same article.
// 2. Conservative fuzzy: a product without a usable GTIN joins a cluster only
//    if the brand and explicit pack count match, total quantity is within ±1%,
//    the cluster has no product from that retailer yet, and name tokens are
//    similar enough with a clear winner. Otherwise it stays on its own:
//    a missed match is cheaper than a wrong price comparison.
import { foldText, isGlobalGtin, nameNumbers, nameTokens, parsePack } from './normalize.mjs'

export const FUZZY_MIN_SCORE = 0.75
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

// Name similarity, or 0 when the evidence is too thin: a single shared word
// only counts when both names consist of that one word, and differing
// identity numbers (age 8-15 vs 8-13, 0% vs 20+) never match.
export function nameScore(a, b) {
  if (a.nums && b.nums && a.nums !== b.nums) return 0
  const setB = new Set(b.tokens)
  const common = new Set(a.tokens.filter((t) => setB.has(t))).size
  if (common === 0) return 0
  if (common === 1 && !(new Set(a.tokens).size === 1 && setB.size === 1)) return 0
  return dice(a.tokens, b.tokens)
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
  // A zero/negative/nonfinite quantity or a fractional/zero pack count
  // cannot establish pack equivalence, regardless of barcode, brand or name.
  // SQL imports may have historical invalid facts: abstain instead of
  // accidentally treating pack_count=0 as a single package via `|| 1`.
  if (typeof p.pack_amount !== 'number' ||
      !Number.isFinite(p.pack_amount) || p.pack_amount <= 0 ||
      typeof p.pack_unit !== 'string' || !p.pack_unit) return null
  const count = p.pack_count
  if (!Number.isSafeInteger(count) || count < 1) return null
  // Pack texts that do not describe one pack (ranges such as "350-390 g") veto
  // fuzzy matching even if an older parser stored an amount for them.
  if (/\d\s*[-–]\s*\d/.test(p.pack_text ?? '') && parsePack(p.pack_text).amount === null) return null
  const total = p.pack_amount * count
  return Number.isFinite(total) && total > 0 ? { unit: p.pack_unit, total, count } : null
}

function samePack(a, b) {
  if (!a || !b || a.unit !== b.unit || a.count !== b.count) return false
  return Math.abs(a.total - b.total) <= Math.max(a.total, b.total) * 0.01
}

/**
 * Two records claiming the same GTIN must also describe the same measurable
 * physical pack. Unknown/invalid dimensions or pack counts cannot establish
 * a trusted cross-retailer identity. Count is explicit: 1×500g and 2×250g
 * can have the same weight but are different retail packs for price comparison.
 */
function sameGtinPhysicalPack(a, b) {
  const countA = a.pack_count
  const countB = b.pack_count
  if (!Number.isSafeInteger(countA) || countA < 1 ||
      !Number.isSafeInteger(countB) || countB < 1 ||
      countA !== countB) return false
  const packA = packKey(a)
  const packB = packKey(b)
  return Boolean(packA && packB &&
    Number.isFinite(packA.total) && packA.total > 0 &&
    Number.isFinite(packB.total) && packB.total > 0 &&
    // A shared EAN does not authorize the ±1% heuristic used by fuzzy
    // brand/name candidates. Payable full-pack prices require the same
    // explicit normalized physical amount, never merely a close amount.
    packA.unit === packB.unit && packA.total === packB.total)
}


// products: [{ id, retailer_id, name, brand, gtins: string[], pack_amount, pack_unit, pack_count }]
export function matchProducts(products) {
  const uf = new UnionFind()
  // A barcode is an identity clue, not permission to compare contradictory
  // physical packs. Keep track of every member in an accepted GTIN cluster:
  // a bridge between two otherwise incompatible packs must not transitively
  // turn two different quantities into one cross-store price identity.
  const byGtin = new Map()
  const gtinMembers = new Map(products.map(product => [product.id, [product]]))
  for (const p of products) {
    uf.find(p.id)
    for (const gtin of p.gtins ?? []) {
      if (!isGlobalGtin(gtin)) continue
      const candidates = byGtin.get(gtin) ?? []
      for (const previous of candidates) {
        const leftRoot = uf.find(previous.id)
        const rightRoot = uf.find(p.id)
        if (leftRoot === rightRoot) continue
        const left = gtinMembers.get(leftRoot)
        const right = gtinMembers.get(rightRoot)
        if (!left.every(a => right.every(b => sameGtinPhysicalPack(a, b)))) continue
        uf.union(leftRoot, rightRoot)
        const root = uf.find(leftRoot)
        gtinMembers.delete(leftRoot)
        gtinMembers.delete(rightRoot)
        gtinMembers.set(root, [...left, ...right])
      }
      candidates.push(p)
      byGtin.set(gtin, candidates)
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
      nums: nameNumbers(p.name),
      pack: packKey(p),
    }
    prepared.set(p.id, info)
    const root = uf.find(p.id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root).push(info)
  }

  const blockKey = (info) =>
    info.brandKey && info.pack
      ? `${info.brandKey}|${info.pack.unit}|count:${info.pack.count}|${Math.round(info.pack.total)}`
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
        best = Math.max(best, nameScore(info, m))
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
    SELECT p.id, p.retailer_id, p.name, p.brand, p.category, p.pack_text, p.pack_amount, p.pack_unit,
           p.pack_count, group_concat(g.gtin) AS gtins
    FROM products p LEFT JOIN product_gtins g ON g.product_id = p.id
    GROUP BY p.id`)
  const products = rows.map((r) => ({
    ...r,
    id: Number(r.id),
    gtins: r.gtins ? String(r.gtins).split(',') : [],
  }))
  const groups = matchProducts(products)
  // The schema deliberately has UNIQUE(canonical_products.gtin). If an EAN
  // appears on incompatible physical packs, both distinct canonical groups
  // must preserve separate rows. A contradictory EAN is no longer a unique
  // canonical identity: store NULL on every conflicting canonical group,
  // while keeping the original individual product_gtins evidence intact.
  const canonicalGtinCounts = new Map()
  for (const group of groups) {
    const gtin = group.canonical.gtin
    if (gtin !== null) {
      canonicalGtinCounts.set(gtin, (canonicalGtinCounts.get(gtin) ?? 0) + 1)
    }
  }
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
      const retainedGtin = c.gtin !== null && canonicalGtinCounts.get(c.gtin) > 1
        ? null : c.gtin
      const { id } = insertCanonical.get(
        retainedGtin,
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
