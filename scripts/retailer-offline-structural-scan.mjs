import { decodeObservedHtmlAttribute } from './retailer-html-attribute-references.mjs'
import { admittedJsonScriptType, admittedRetailerScriptId } from './retailer-json-script-mime.mjs'
import { parseUniqueKeyRetailerJson } from './retailer-private-unique-key-json.mjs'

/**
 * Static, bounded HTML token scan for OFFLINE selector *proposals*.
 * Script JSON and quoted markup are never executed or promoted as prices.
 * Not a DOM validation or an approval for live retailer access.
 */
const RAW = new Set(['script','style','textarea','title','xmp','iframe','noembed','noframes']);
const HIDDEN = new Set(['template','noscript','svg','head','style','textarea','title','xmp','iframe','noembed','noframes']);
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

function attrs(raw) {
  const result = new Map();
  let at = 0;
  while (at < raw.length) {
    while (/\s/.test(raw[at] ?? '')) at++;
    if (at >= raw.length || (raw[at] === '/' && !raw.slice(at + 1).trim())) break;
    const name = /^[a-z_:][a-z0-9_.:-]*/i.exec(raw.slice(at))?.[0];
    if (!name || result.size >= 64) throw new Error('Invalid offline attribute');
    at += name.length;
    const key = name.toLowerCase();
    if (result.has(key)) throw new Error('Duplicate offline attribute');
    while (/\s/.test(raw[at] ?? '')) at++;
    let value = null;
    if (raw[at] === '=') {
      at++;
      while (/\s/.test(raw[at] ?? '')) at++;
      if (raw[at] === '"' || raw[at] === "'") {
        const mark = raw[at++];
        const end = raw.indexOf(mark, at);
        if (end < 0) throw new Error('Unterminated offline attribute');
        value = raw.slice(at, end);
        at = end + 1;
      } else {
        const match = /^[^\s<>=`"']+/.exec(raw.slice(at));
        if (!match) throw new Error('Invalid offline unquoted attribute');
        value = match[0];
        at += value.length;
      }
      if (value.length > 1000) throw new Error('Oversized offline attribute');
    }
    result.set(key, value);
  }
  return result;
}

function tagEnd(html, start) {
  let quote = null;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '<') throw new Error('Malformed offline tag');
    else if (char === '>') return i;
  }
  throw new Error('Unterminated offline tag');
}

// Meta controls are interpreted by browsers after HTML entity decoding.
// Numeric entities and common ASCII named entities are decoded only for
// security metadata and explicit microdata itemtypes; unresolved entities fail closed.
const decodedMeta = decodeObservedHtmlAttribute

function isType(record, type) {
  if (!record || typeof record !== 'object') return false;
  const t = record['@type'];
  // Schema.org permits a short term or an absolute class IRI. An arbitrary
  // host ending in /Product is not evidence of a Schema.org product.
  const expected = new Set([type, 'https://schema.org/' + type, 'http://schema.org/' + type]);
  return typeof t === 'string' ? expected.has(t) :
    (Array.isArray(t) && t.some(x => typeof x === 'string' && expected.has(x)));
}
// Explicit foreign JSON-LD contexts must not masquerade as Schema.org.
function schemaContext(value) {
  const official = new Set(['https://schema.org','https://schema.org/',
    'http://schema.org','http://schema.org/']);
  if (typeof value === 'string') return official.has(value);
  if (Array.isArray(value)) return value.length > 0 && value.every(schemaContext);
  return value !== null && typeof value === 'object' &&
    Object.keys(value).length === 1 && Object.hasOwn(value,'@vocab') &&
    official.has(value['@vocab']);
}
function hasProduct(value, depth = 0, inheritedSchemaContext = false) {
  if (depth > 5 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(x => hasProduct(x,depth+1,inheritedSchemaContext));
  const declaresContext=Object.hasOwn(value,'@context');
  if (declaresContext && !schemaContext(value['@context'])) return false;
  const officialContext=inheritedSchemaContext || declaresContext;
  // A plain @type="Product" is only a Schema.org class when an official
  // context defines the term. A fully qualified official class IRI is
  // independently unambiguous, even without a surrounding @context.
  const rawType=value['@type'];
  const fullOfficial=['https://schema.org/Product','http://schema.org/Product'];
  const explicitOfficial=typeof rawType==='string'
    ? fullOfficial.includes(rawType)
    : Array.isArray(rawType) && rawType.some(type=>fullOfficial.includes(type));
  if ((officialContext || explicitOfficial) && isType(value,'Product')) return true;
  return ['@graph','mainEntity','itemListElement','item'].some(key =>
    hasProduct(value[key],depth+1,officialContext));
}

// Reuse the same official-context check for the historical M1 source
// inspector, not a weaker bare @type="Product" admission.
export { hasProduct as hasVerifiedSchemaProduct }

// includeScripts is for the trusted private PRICE parser only. The public
// selector report continues to expose only counts and booleans by default.
export function scanOfflineRetailerMarkup(html, { includeScripts = false } = {}) {
  const visible = [];
  const scripts = includeScripts ? [] : null;
  const signals = { schemaOrgProduct:false, nextData:false, nuxtData:false, jsonLd:false };
  const hidden = [];
  // Keep live HTML base href facts separate from visible DOM selectors.
  const baseHrefs = [];
  const canonicalHrefs = [];
  let hasMetaRefresh = false;
  let hasMetaNoStore = false;
  let hasMetaNoArchive = false;
  let hasConflictingCharset = false;
  let pos = 0;
  let inspected = 0;
  while (pos < html.length) {
    const start = html.indexOf('<', pos);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) throw new Error('Unterminated HTML comment');
      pos = end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', start)) {
      const end = html.indexOf(']]>', start + 9);
      if (end < 0) throw new Error('Unterminated HTML CDATA');
      pos = end + 3;
      continue;
    }
    // DOCTYPE, invalid HTML internal subsets, XML processing instructions and
    // conditional declarations are never DOM elements. Their quoted contents
    // must not be rescanned as live Product scripts or selector-bearing tags.
    if (html.startsWith('<!', start) || html.startsWith('<?', start)) {
      pos = tagEnd(html, start + 2) + 1;
      continue;
    }
    const token = /^<(\/?)([a-z][a-z0-9-]{0,32})\b/i.exec(html.slice(start));
    if (!token) { pos = start + 1; continue; }
    if (++inspected > 25000) throw new Error('Offline token budget exceeded');
    const end = tagEnd(html, start + token[0].length);
    const tag = token[2].toLowerCase();
    const close = token[1] === '/';
    const attrText = html.slice(start + token[0].length, end);
    if (close) {
      // Keep genuine visible end tags for conservative ancestor-aware selector
      // review; never expose suppressed/template/raw-element closes.
      if (!hidden.length && !HIDDEN.has(tag)) visible.push('</' + tag + '>');
      // Suppressed HTML is not a source of selector or structured evidence.
      if (hidden.at(-1) === tag) hidden.pop();
      pos = end + 1;
      continue;
    }
    const values = attrs(attrText);
    // HTML permits an omitted </head> when <body> starts. This is the one
    // implicit close we can prove statically without a complete DOM parser;
    // nested inert/template contexts still fail closed.
    if (tag === 'body' && hidden.length === 1 && hidden[0] === 'head') hidden.pop();
    // HTML plaintext mode consumes the rest of the document as literal text;
    // even a matching </plaintext> is not a real closing tag in the DOM.
    // Ignore any apparent script/selector tags following it.
    if (tag === 'plaintext') break;
    const suppressed = hidden.length > 0;
    if (tag === 'meta' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head')) {
      for (const key of ['name','http-equiv','content','charset']) {
        if (values.has(key)) values.set(key,decodedMeta(values.get(key)));
      }
      if (['name','http-equiv'].some(key => values.get(key)?.includes('&')))
        throw new Error('Ambiguous HTML meta control');
      const content=values.get('content');
      if (typeof content === 'string' && content.includes('&') &&
          (/^(?:robots|googlebot|bingbot)$/i.test(values.get('name')??'') ||
           /^(?:cache-control|refresh|content-type)$/i.test(values.get('http-equiv')??'')))
        throw new Error('Ambiguous HTML meta content');
    }
    if (tag === 'base' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head') &&
        values.has('href')) {
      if (baseHrefs.length) throw new Error('Multiple live HTML base URLs');
      baseHrefs.push(values.get('href'));
    }
    // Browsers decode character references in rel tokens too. Otherwise a
    // rel="canon&#105;cal" could silently hide a cross-origin canonical URL.
    if (tag === 'link' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head') && values.has('rel')) {
      const rel = decodedMeta(values.get('rel'));
      if (typeof rel !== 'string' || rel.includes('&'))
        throw new Error('Ambiguous canonical retailer source URL');
      values.set('rel',rel);
    }
    // Only genuine live <link rel=canonical> elements count as source page
    // identity. Quoted fake markup and inert template/script tags are ignored.
    if (tag === 'link' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head') &&
        typeof values.get('rel') === 'string' &&
        values.get('rel').toLowerCase().split(/[ \t\n\f\r]+/).includes('canonical')) {
      if (canonicalHrefs.length || !values.has('href'))
        throw new Error('Ambiguous canonical retailer source URL');
      canonicalHrefs.push(values.get('href'));
    }
    // A live document-level meta refresh can navigate away after the initial
    // 200 capture. Such HTML is not a stable product-price/selector source.
    if (tag === 'meta' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head') &&
        typeof values.get('http-equiv') === 'string' &&
        values.get('http-equiv').trim().toLowerCase() === 'refresh') {
      hasMetaRefresh = true;
    }
    // Honor live document-level no-store without trusting inert fake tags.
    if (tag === 'meta' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head') &&
        typeof values.get('http-equiv') === 'string' &&
        values.get('http-equiv').trim().toLowerCase() === 'cache-control' &&
        typeof values.get('content') === 'string' &&
        /(?:^|[,;])\s*no-store(?:\s*(?:[=;,]|$))/i.test(values.get('content'))) {
      hasMetaNoStore = true;
    }
    // Respect genuine document-level search-engine archival opt-outs too.
    // A noarchive directive is not price evidence and must not enter a
    // persistent capture or selector archive. Ignore template/script fakes.
    if (tag === 'meta' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head') &&
        /^(?:robots|googlebot|bingbot)$/i.test(values.get('name') ?? '') &&
        typeof values.get('content') === 'string' &&
        /(?:^|[,;\s])noarchive(?=$|[,;\s])/i.test(values.get('content'))) {
      hasMetaNoArchive = true;
    }
    // A browser may decode the same captured bytes differently when an HTML
    // meta declaration disagrees with our UTF-8-only snapshot contract.
    if (tag === 'meta' && (hidden.length === 0 ||
        hidden.length === 1 && hidden[0] === 'head')) {
      const declared = values.get('charset')
      if (values.has('charset') &&
          (typeof declared !== 'string' || !/^utf-?8$/i.test(declared.trim()))) {
        hasConflictingCharset = true
      }
      if (values.get('http-equiv')?.trim().toLowerCase() === 'content-type' &&
          !/^text\/html\s*;\s*charset\s*=\s*["']?utf-?8["']?\s*$/i
            .test(values.get('content') ?? '')) {
        hasConflictingCharset = true
      }
    }
    if (!suppressed && !HIDDEN.has(tag) && tag !== 'script') {
      // Schema.org microdata is an observed DOM alternative to JSON-LD.
      // Only explicit live itemscope + exact official itemtype is a product
      // hint. Never infer an item from similarly named foreign vocabularies.
      if (values.has('itemscope') && typeof values.get('itemtype') === 'string') {
        // Browser DOM decodes itemtype entities before Schema.org microdata parsing.
        // Use the same one-pass decoding as source-identity controls, never
        // interpret encoded foreign vocabularies as official Product.
        const types = decodedMeta(values.get('itemtype')).trim().split(/[ \t\n\f\r]+/);
        const official = new Set(['https://schema.org/Product',
          'http://schema.org/Product','https://schema.org/Thing',
          'http://schema.org/Thing']);
        if (types.includes('https://schema.org/Product') ||
            types.includes('http://schema.org/Product')) {
          if (types.every(type => official.has(type))) signals.schemaOrgProduct=true;
        }
      }
      // Retain the *actual* start tag only. Never reinterpret its attributes
      // as independent HTML elements, even if they contain "<span ...>".
      visible.push(html.slice(start, end + 1));
    }
    if (RAW.has(tag)) {
      const closer = new RegExp('<\\/' + tag + '\\s*>', 'gi');
      closer.lastIndex = end + 1;
      const closing = closer.exec(html);
      if (!closing) throw new Error('Unbalanced inert HTML element');
      const trustedScriptContext = !hidden.some(name => name !== 'head') && tag === 'script';
      if (trustedScriptContext && includeScripts) {
        scripts.push({ attrs: values, rawAttributeLength: attrText.length,
          content: html.slice(end + 1, closing.index) });
      }
      if (trustedScriptContext && !values.has('src')) {
        // MIME type matching ignores surrounding ASCII whitespace, matching
        // the already strict private JSON-LD/Nuxt source evidence reader.
        const type = admittedJsonScriptType(values.get('type'));
        const id = admittedRetailerScriptId(values.get('id'));
        const content = html.slice(end + 1, closing.index).trim();
        if (type !== null && id !== null && Buffer.byteLength(content, 'utf8') <= 1024 * 1024) {
          let parsed = null;
          // A structural Product/SSR signal must meet the same unambiguous
          // JSON grammar as the private priced evidence reader. Duplicate
          // keys (including escaped aliases) must not create false proof.
          try { parsed = parseUniqueKeyRetailerJson(content); } catch {}
          if (type === 'application/ld+json' && parsed !== null) {
            signals.jsonLd = true;
            if (hasProduct(parsed)) signals.schemaOrgProduct = true;
          }
          if (id === '__NUXT_DATA__' && (type === undefined || type === 'application/json') &&
              Array.isArray(parsed)) signals.nuxtData = true;
          if (id === '__NEXT_DATA__' && (type === undefined || type === 'application/json') &&
              parsed && typeof parsed === 'object' && !Array.isArray(parsed)) signals.nextData = true;
        }
      }
      pos = closer.lastIndex;
      continue;
    }
    if (HIDDEN.has(tag) && !VOID.has(tag)) hidden.push(tag);
    pos = end + 1;
  }
  if (hidden.length) throw new Error('Unbalanced inert HTML element');
  return { visible: visible.join(''), structuredSignals: signals,
    baseHrefs, canonicalHrefs, hasMetaRefresh, hasMetaNoStore, hasMetaNoArchive, hasConflictingCharset,
    ...(includeScripts ? { scripts } : {}) };
}
