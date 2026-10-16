#!/usr/bin/env node
// Turn a saved retailer page into a compact test fixture: keeps the markup and
// the structured-data scripts adapters read, drops styles, SVG and code.
//   node scraper/make-fixture.mjs <saved.html[.gz]> <url> fixtures/scraper/<name>.html.gz
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'

const [src, url, dst] = process.argv.slice(2)
if (!src || !url || !dst) {
  console.error('usage: make-fixture.mjs <saved.html[.gz]> <url> <out.html.gz>')
  process.exit(1)
}
let buf = readFileSync(src)
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
const html = buf
  .toString('utf8')
  .replace(/^<!-- \S+ -->\n/, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
  .replace(/<link\b[^>]*>/gi, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) =>
    /application\/ld\+json|__NUXT_DATA__|__NEXT_DATA__|window\.__NUXT__/.test(tag) ? tag : '',
  )
  .replace(/\n\s*\n+/g, '\n')
writeFileSync(dst, gzipSync(`<!-- ${url} -->\n${html}`))
console.log(`${dst}: ${html.length} bytes`)
