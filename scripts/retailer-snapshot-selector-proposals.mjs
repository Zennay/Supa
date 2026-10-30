import { ambiguousRetailerRoute, isAllowedM1RetailerSourcePath } from './retailer-source-route-safety.mjs'
import { scanOfflineRetailerMarkup } from './retailer-offline-structural-scan.mjs'
import { admittedJsonScriptType, admittedRetailerScriptId } from './retailer-json-script-mime.mjs'
import { proposeOfflineRetailerSelectors, summarizeOfflineSelectorProposals, assertObservedRetailerHtmlIdentity, openingTags, staticAttributeValue } from './retailer-offline-selector-discovery.mjs'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'
import { decodeExactRetailerHtmlBytes } from './retailer-private-html-byte-identity.mjs'
/**
 * OFFLINE selector discovery from a previously approved and integrity-linked M1
 * capture. A proposal is NEVER an extracted product, verified selector, license
 * or source permission. No HTTP, browser automation or remote DOM access.
 */
import { createHash } from 'node:crypto'
import { types as nodeTypes } from 'node:util'
import { lstat, open, mkdir, writeFile } from 'node:fs/promises'
import { constants as fsFlags } from 'node:fs'
import { dirname, resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_HTML_TAGS = 100_000
const MAX_CAPTURE_SOURCES = 32
const HOSTS = { plus: 'www.plus.nl', dekamarkt: 'www.dekamarkt.nl' }
const KINDS = new Set(['product', 'catalog', 'offers'])
const ALLOWED_JSONLD_KEYS = new Set([
  '@context', '@type', '@graph', 'sku', 'gtin', 'gtin13', 'mpn',
  'name', 'offers', 'price', 'Price', 'priceCurrency',
  'availability', 'weight', 'value', 'unitCode', 'priceSpecification',
])
const CLASS_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,60}$/
const RELEVANCE_PATTERN = /(?:product|price|pack|aanbied|offer|plp|pdp|item|unit|stock|amount|naam|name|sku|koop|beschik|promo|ingredient|beschrijv)/i

function reject(message) { throw new Error('Offline selector review refused: ' + message) }
function sha256(html) { return createHash('sha256').update(html, 'utf8').digest('hex') }
function owned(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}
function mapCandidateFields(suggestions) {
  // Semantic hints for AI/human review; NOT parsed product values or vetted CSS.
  const patterns = {
    name: /name|naam|title/i,
    price: /price|prijs/i,
    package: /pack|complementary|unit|weight|size|gewicht/i,
    offer: /offer|promo|aanbied|korting/i,
    availability: /stock|availability|inventory|beschik/i,
  }
  return Object.fromEntries(Object.entries(patterns).map(([field, expression]) => [
    field,
    suggestions.filter(item => expression.test(item.selector))
      .slice(0, 8).map(item => ({
        selector: item.selector, status: 'UNVERIFIED_FIELD_HINT',
        reviewerMustVerifySemantics: true,
      })),
  ]))
}
function validCapture(source, requireHash = true) {
  // Archived manifests are untrusted input, not objects allowed to execute
  // caller-supplied Proxy descriptor traps during provenance validation.
  // Accessor-backed fields remain rejected by owned() below.
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      nodeTypes.isProxy(source) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(source)))
    reject('malformed source')
  const supermarket = owned(source, 'supermarket')
  const kind = owned(source, 'kind')
  const sourceUrl = owned(source, 'url')
  const urlValue = owned(source, 'finalUrl') ?? owned(source, 'requestedUrl') ?? sourceUrl
  const capturedAt = owned(source, 'capturedAt')
  const id = owned(source, 'id')
  const expectedSha = owned(source, 'sha256')
  const requestedUrl = owned(source, 'requestedUrl')
  const finalUrl = owned(source, 'finalUrl')
  // Old and current M1 manifests may carry url/requestedUrl/finalUrl.
  // All present identities must agree: selecting only the first non-nullish
  // field would let an archive attach a different SKU/store to approved HTML.
  const aliases=[sourceUrl,requestedUrl,finalUrl].filter(x=>x !== undefined)
  if (aliases.length > 1 && aliases.some(x=>x!==aliases[0]))
    reject('conflicting retailer source URL aliases or redirect')
  if (!Object.hasOwn(HOSTS, supermarket) || !KINDS.has(kind) ||
      typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(id) ||
      (requireHash ? (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha)) : (expectedSha !== undefined && (typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha)))) ||
      typeof capturedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(capturedAt)) reject('invalid capture identity/hash/timestamp')
  // Date.parse silently rolls nonexistent calendar dates into a later month.
  // Bind archival provenance to its original UTC civil day/time, not a
  // normalized clock that was never actually observed.
  const timestamp = Date.parse(capturedAt)
  if (!Number.isFinite(timestamp) || timestamp > Date.now() ||
      new Date(timestamp).toISOString().slice(0,19) !== capturedAt.slice(0,19))
    reject('invalid capture Gregorian UTC timestamp')
  let url
  try { url = new URL(urlValue) } catch { reject('invalid source URL') }
  if (url.href !== urlValue ||
      !isAllowedM1RetailerSourcePath(supermarket,kind,url.pathname) ||
      url.protocol !== 'https:' || url.hostname !== HOSTS[supermarket] ||
      url.port || url.username || url.password || url.search || url.hash) {
    reject('unapproved source host, URL or credentials')
  }
  return { id, supermarket, kind, url: url.href, capturedAt, sha256: expectedSha ?? null }
}

const OFFICIAL_SCHEMA_CONTEXT = new Set([
  'https://schema.org','https://schema.org/',
  'http://schema.org','http://schema.org/',
])
function schemaVocabulary(value) {
  if (typeof value === 'string') return OFFICIAL_SCHEMA_CONTEXT.has(value)
  if (Array.isArray(value)) return value.length>0 && value.every(schemaVocabulary)
  return value && typeof value === 'object' &&
    Object.keys(value).length === 1 && OFFICIAL_SCHEMA_CONTEXT.has(value['@vocab'])
}
function jsonLdShape(text, types, keys) {
  let value
  // Duplicate JSON-LD members cannot become apparently verified source
  // attributes through JSON.parse's last-key-wins behavior.
  try { value = parseUniqueKeyRetailerJson(text) } catch { return false }
  const visit = (node, depth = 0, inheritedSchema = false) => {
    if (depth > 12 || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.slice(0,100).forEach(child => visit(child,depth+1,inheritedSchema))
      return
    }
    const declaresContext = Object.hasOwn(node,'@context')
    const localContextOfficial = declaresContext && !!schemaVocabulary(node['@context'])
    const trusted = declaresContext ? localContextOfficial : inheritedSchema
    const foreignContext = declaresContext && !localContextOfficial
    const classes=Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
    // A WebPage that happens to contain "price" or "sku" is not product
    // evidence. Only source-observed, official retail schema records may
    // contribute product/pack/offer field names to the private review.
    const retailFields=!foreignContext && classes.some(type => typeof type === 'string' &&
      /^(?:https?:\/\/schema\.org\/)?(Product|Offer|AggregateOffer|PriceSpecification|QuantitativeValue)$/.test(type) &&
      (trusted || (!declaresContext && /^https?:\/\/schema\.org\//.test(type))))
    for (const [key,child] of Object.entries(node).slice(0,100)) {
      if (ALLOWED_JSONLD_KEYS.has(key) &&
          ((trusted && key.startsWith('@')) || retailFields)) keys.add(key)
      if (key === '@type') {
        for(const type of (Array.isArray(child)?child:[child])) {
          if(typeof type !== 'string') continue
          const match=/^(?:https?:\/\/schema\.org\/)?(Product|Offer|AggregateOffer|ItemList|WebPage)$/.exec(type)
          if(match && (trusted || (!declaresContext && type !== match[1])))
            types.add(match[1])
        }
      }
      // Walk only Schema.org graph/retail relationships. Arbitrary private
      // metadata, debug objects and annotations are not nested products,
      // even when they happen to carry an @type key or official-looking IRI.
      // This is an offline structural review hint, not a product price parser.
      if (['@graph','mainEntity','itemListElement','item','offers',
           'priceSpecification'].includes(key) && child && typeof child === 'object')
        visit(child,depth+1,trusted)
    }
  }
  visit(value)
  return true
}

function assertClosedInertMarkup(html) {
  // Static tag extraction cannot distinguish script/template/comment text from
  // real DOM if delimiters are truncated. Refuse the entire snapshot instead
  // of treating an unterminated inert fragment as price/stock evidence.
  const commentsRemoved = html.replace(/<!--[\s\S]*?-->/g, ' ')
  if (commentsRemoved.includes('<!--') || commentsRemoved.includes('-->')) {
    reject('unclosed inert HTML comment')
  }
  for (const tag of ['script', 'style', 'template', 'noscript', 'textarea', 'head', 'svg']) {
    const opened = [...commentsRemoved.matchAll(new RegExp('<' + tag + '\\b', 'gi'))].length
    const closed = [...commentsRemoved.matchAll(new RegExp('<\\/' + tag + '\\s*>', 'gi'))].length
    if (opened !== closed) reject('unclosed inert HTML element')
  }
}

export function proposeRetailerSelectors(source, html) {
  const identity = validCapture(source)
  if (typeof html !== 'string' || html.startsWith('\uFEFF') ||
      html.includes('\u0000') ||
      Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES ||
      Buffer.from(html, 'utf8').toString('utf8') !== html ||
      sha256(html) !== identity.sha256) reject('HTML must be bounded, UTF-8 and match source SHA-256')
  assertClosedInertMarkup(html)
  // A historical approved capture is still subject to the current source
  // archival contract. Never derive candidate selectors from a page that
  // explicitly forbids retention, redirects, or declares a non-UTF8 DOM.
  const document = scanOfflineRetailerMarkup(html,{includeScripts:true})
  if (document.hasMetaNoStore || document.hasMetaNoArchive || document.hasMetaRefresh ||
      document.hasConflictingCharset) {
    reject('retailer HTML source directives prohibit selector review')
  }
  // The old M1 entrypoint must not silently fall back to class-only hints
  // when the page advertises a foreign browser base or canonical identity.
  // Apply the identical source-origin contract as the modern private engine,
  // including over-2MiB historical captures not eligible for modern replay.
  try {
    assertObservedRetailerHtmlIdentity(identity.url,
      document.baseHrefs,document.canonicalHrefs)
  } catch { reject('untrusted retailer HTML base or canonical source identity') }
  let nuxtScriptCount = 0
  let eligibleNuxtPayload = false
  const jsonLdTypes = new Set()
  const jsonLdKeys = new Set()
  let invalidJsonLdCount = 0
  // Inspect only script elements proved live by the same bounded HTML scanner.
  // Matching raw HTML with a regex admitted fake JSON-LD scripts embedded
  // inside <style>, inert SVG or quoted attribute values. Never execute JS.
  for(const script of document.scripts){
    if(script.attrs.has('src')) continue
    // Browser-decoded script MIME/ID is shared with strict private evidence.
    // Only exact UTF-8 JSON types qualify as review signals; no prices.
    const scriptType=admittedJsonScriptType(script.attrs.get('type'))
    if(scriptType==='application/ld+json'){
      if(!jsonLdShape(script.content,jsonLdTypes,jsonLdKeys)) invalidJsonLdCount++
    }
    if (admittedRetailerScriptId(script.attrs.get('id'))==='__NUXT_DATA__') {
      nuxtScriptCount++
      if (scriptType === undefined || scriptType === 'application/json') {
        // An ID is not an SSR data source by itself. The private price parser
        // requires an unambiguous bounded JSON array with unique object keys.
        // Keep exactly the same conditions for historical review signals.
        if (Buffer.byteLength(script.content,'utf8') <= 1024 * 1024) {
          try {
            const payload = parseUniqueKeyRetailerJson(script.content.trim())
            if (Array.isArray(payload) && payload.length <= 25000)
              eligibleNuxtPayload = true
          } catch { /* no source evidence from invalid JSON */ }
        }
      }
    }
  }
  // Every class candidate must correspond to an actual visible opening tag,
  // not markup-shaped text inside a script/style/template/attribute.
  const activeHtml=document.visible
  const counts = new Map()
  let htmlTagCount = 0
  // Use quote-aware parsed opening tags, not a second regex over HTML.
  // A literal '<span class=...>' inside an attribute is NOT a live element.
  // The same parser is shared with the strict source-observed M1 extractor.
  for (const tag of openingTags(activeHtml)) {
    htmlTagCount++
    if (htmlTagCount > MAX_HTML_TAGS) reject('unbounded HTML tag count')
    const tagName=tag.tag
    // Decode classList as a browser does, exactly once, sharing the primary
    // source scanner rather than inventing selectors from encoded strings.
    const classText=staticAttributeValue(tag.attrs.get('class'))
    if (typeof classText !== 'string' || classText.length > 512) continue
    const classes=classText.trim().split(/[ \t\n\f\r]+/).slice(0,24)
    for (const name of classes) {
      if (!CLASS_PATTERN.test(name) || !RELEVANCE_PATTERN.test(name)) continue
      const selector=tagName+'.'+name
      counts.set(selector,(counts.get(selector)??0)+1)
    }
  }
  const suggestions = [...counts.entries()]
    .sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b))
    .slice(0, 40)
    .map(([selector, occurrences]) => ({
      selector, occurrences, status: 'UNVERIFIED_PROPOSAL',
      requiresReviewedSnapshotAndHumanApproval: true,
    }))
  // Reuse the stricter source-observed selector engine for genuine product
  // microdata and public product-link roots. Historical source readers may
  // have older clock formats: if the modern analyzer declines, do not invent
  // candidates and preserve the original class-only review.
  let semantic = []
  try {
    const discovered = proposeOfflineRetailerSelectors({html,origin:{
      retailerId:identity.supermarket,url:identity.url,capturedAt:identity.capturedAt}})
    semantic = summarizeOfflineSelectorProposals(discovered).selectors
      // Only the modern scanner's pre-sanitized, public vocabulary hints.
      // No original price, ID, href or arbitrary CSS token is copied.
      .filter(row => row.field === 'product' ||
        row.selector.includes('[itemprop="'))
      .map(row => ({selector:row.selector,occurrences:row.instances,
        status:'UNVERIFIED_PROPOSAL',requiresReviewedSnapshotAndHumanApproval:true}))
  } catch { /* No new review proposals when the strict modern scanner refuses. */ }
  const observed = new Map()
  for(const row of [...semantic,...suggestions])
    if(!observed.has(row.selector)) observed.set(row.selector,row)
  const completeSuggestions=[...observed.values()].slice(0,40)
  return {
    schemaVersion: 1,
    artifactType: 'supa-offline-selector-proposals',
    source: identity,
    byteLength: Buffer.byteLength(html, 'utf8'),
    inspectedTagCount: htmlTagCount,
    embeddedSignals: {
      nuxtDataScriptPresent: nuxtScriptCount === 1 && eligibleNuxtPayload,
      jsonLdTypes: [...jsonLdTypes].sort(),
      jsonLdKeys: [...jsonLdKeys].sort(),
      invalidJsonLdCount,
    },
    proposedSelectors: completeSuggestions,
    possibleFieldSelectors: mapCandidateFields(completeSuggestions),
    readyForScraping: false, sourcePermissionVerified: false,
    currentPricesExtracted: false, publicationAllowed: false,
  }
}

async function checkNonSymlinkParents(path) {
  let current = resolve(path)
  for (;;) {
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) reject('symlink path components not allowed')
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (current === parent) break
    current = parent
  }
}
// Read exactly one pinned regular inode; never follow an alias after
// checking its name. Old path-based lstat/readFile was open to swap races.
async function readPinnedCaptureFile(path, limit) {
  await checkNonSymlinkParents(path)
  const parent = await lstat(dirname(path))
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > limit) reject('unsafe snapshot inode')
  const handle = await open(path, fsFlags.O_RDONLY | fsFlags.O_NOFOLLOW |
    fsFlags.O_NONBLOCK)
  try {
    const fdBefore = await handle.stat()
    if (!fdBefore.isFile() || fdBefore.nlink !== 1 ||
        fdBefore.size !== before.size || fdBefore.dev !== before.dev ||
        fdBefore.ino !== before.ino) reject('snapshot swapped before open')
    const bytes = await handle.readFile()
    const fdAfter = await handle.stat()
    await checkNonSymlinkParents(path)
    const named = await lstat(path)
    const parentAfter = await lstat(dirname(path))
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1 ||
        named.dev !== fdAfter.dev || named.ino !== fdAfter.ino ||
        parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino ||
        before.size !== bytes.length || fdAfter.size !== bytes.length ||
        fdBefore.mtimeMs !== fdAfter.mtimeMs ||
        fdBefore.ctimeMs !== fdAfter.ctimeMs) {
      reject('snapshot identity changed during inspection')
    }
    return bytes
  } finally { await handle.close() }
}

export async function proposeFromM1CaptureDirectory(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') reject('capture path required')
  await checkNonSymlinkParents(dir)
  const manifestPath = join(resolve(dir), 'manifest.json')
  await checkNonSymlinkParents(manifestPath)
  let manifest
  try {
    manifest = parseUniqueKeyRetailerJson(
      new TextDecoder('utf-8', { fatal:true })
        .decode(await readPinnedCaptureFile(manifestPath, 512 * 1024)), 512 * 1024)
  } catch { reject('invalid manifest JSON or file') }
  if (!manifest || !Array.isArray(manifest.results) ||
      manifest.results.length < 1 || manifest.results.length > MAX_CAPTURE_SOURCES ||
      manifest.sourceCount !== manifest.results.length) reject('invalid bounded capture manifest')
  const proposals = []
  const seen = new Set()
  for (const record of manifest.results) {
    if (typeof record.success !== 'boolean') reject('capture success flag missing')
    const source = validCapture(record, record.success === true)
    if (seen.has(source.id)) reject('duplicate source ID')
    seen.add(source.id)
    if (record.success !== true) {
      proposals.push({ sourceId: source.id, status: 'CAPTURE_UNAVAILABLE', reason: 'not a successful authorized capture' })
      continue
    }
    const filename = join(resolve(dir), source.supermarket, source.id + '.html')
    await checkNonSymlinkParents(filename)
    const html = decodeExactRetailerHtmlBytes(
      await readPinnedCaptureFile(filename, MAX_HTML_BYTES), MAX_HTML_BYTES)
    proposals.push(proposeRetailerSelectors(source, html))
  }
  return {
    schemaVersion: 1, captureDirectoryReviewOnly: true,
    analyzedSources: proposals.length, selectorSets: proposals,
    automatedSelectorPromotion: false, productionEnabled: false,
    legalAccessMustBeVerifiedSeparately: true,
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3 || argv[0] !== '--out' ||
      !argv[1] || !argv[2] || argv[1].startsWith('-') || argv[2].startsWith('-')) {
    reject('usage: --out <new-local-proposals.json> <existing-approved-M1-capture-dir>')
  }
  const output = resolve(argv[1])
  const input = resolve(argv[2])
  if (output === input || output.startsWith(input + sep)) reject('output must be outside capture tree')
  await checkNonSymlinkParents(output)
  const report = await proposeFromM1CaptureDirectory(input)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await checkNonSymlinkParents(output)
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ selectorReviewWritten: true, sourceCount: report.analyzedSources, productionEnabled: false }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('Offline selector proposal refused. Nothing was promoted or published.')
    process.exitCode = 1
  })
}
