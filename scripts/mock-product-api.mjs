// Tiny local stand-in for the scraper API, to test the frontend connection.
// Run: node scripts/mock-product-api.mjs   then   VITE_API_URL=http://127.0.0.1:4180 npm run dev
import { createServer } from 'node:http'

const products = [
  { id: 'mock-1', name: 'Mock Halfvolle melk 1 liter', store: 'jumbo', unit: '1L', unitPrice: '€1.19/L', priceCents: 119, oldPriceCents: 139, observedAt: new Date().toISOString() },
  { id: 'mock-2', name: 'Mock Pindakaas 650 gram', store: 'dirk', unit: '650 gram', unitPrice: '€4.60/kg', priceCents: 299, oldPriceCents: 436, observedAt: new Date().toISOString() },
  { id: 'mock-3', name: 'Mock Bananen', store: 'plus', unit: '1 kg', priceCents: 137, observedAt: new Date().toISOString() },
  { id: 'mock-4', name: 'Mock Spaghetti 500 gram', store: 'ah', unit: '500 gram', priceCents: 109, observedAt: new Date().toISOString() },
]

createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  if (req.url?.startsWith('/v1/products')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ products }))
    return
  }
  res.statusCode = 404
  res.end('not found')
}).listen(4180, '127.0.0.1', () => console.log('mock product API on http://127.0.0.1:4180'))
