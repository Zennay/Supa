/* Run as a local browser DevTools Snippet on a public supermarket page.
 * Inspect actual rendered DOM only: no network requests or raw price extraction.
 */
;(() => {
  'use strict'
  const allowed = new Set(['www.ah.nl', 'www.dirk.nl', 'www.hoogvliet.com', 'www.jumbo.com'])
  const location = globalThis.location
  if (!location || location.protocol !== 'https:' || !allowed.has(location.hostname)) {
    throw new Error('Supa research probe: open an approved public supermarket HTTPS page first')
  }
  const candidates = [
    ['product-name', 'h1'],
    ['product-name', '[itemprop="name"]'],
    ['product', 'a[href*="/product"]'],
    ['product', '[itemtype*="schema.org/Product"]'],
    ['price', '[itemprop="price"]'],
    ['price', '[data-testid*="price" i]'],
    ['price', '[class*="price" i]'],
    ['pack', '[class*="quantity" i]'],
    ['pack', '[class*="weight" i]'],
    ['offers', '[class*="offer" i]'],
    ['offers', '[class*="promotion" i]'],
  ]
  const results = []
  for (const [role, selector] of candidates) {
    let count = 0
    try { count = document.querySelectorAll(selector).length } catch { continue }
    if (count > 0) results.push({ role, selector, count, groundedInCurrentDom: true, semanticVerified: false })
  }
  const observed = new Map()
  const elements = document.querySelectorAll('h1, [itemprop="price"], [data-testid*="price" i], [class*="price" i], a[href*="/product"]')
  for (const element of Array.from(elements).slice(0, 500)) {
    const tag = String(element.tagName || '').toLowerCase()
    if (!/^[a-z][a-z0-9-]{0,25}$/.test(tag)) continue
    const classes = Array.from(element.classList || [])
    for (const name of classes.slice(0, 5)) {
      if (!/^[a-z_][a-z0-9_-]{1,45}$/i.test(name)) continue
      const selector = tag + '.' + name
      observed.set(selector, (observed.get(selector) || 0) + 1)
    }
  }
  const actualClassCandidates = [...observed.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([selector, observedNodes]) => ({ selector, observedNodes, semanticVerified: false }))
  const report = {
    version: 1,
    kind: 'rendered-dom-candidate-only',
    originHost: location.hostname,
    capturedAt: new Date().toISOString(),
    selectors: results,
    actualClassCandidates,
    note: 'DOM structural candidates only. No product/price semantics verified; inspect real elements and source permission before extraction.',
  }
  console.log('SUPA bounded DOM candidates (NO price evidence)', JSON.stringify(report, null, 2))
  return report
})()
