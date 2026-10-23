import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function publicAddress(address) {
  // IPv6 is deliberately refused; IPv4-mapped IPv6 must not bypass these ranges.
  if (isIP(address) !== 4) return false
  const [a, b, c] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113))
}

// Apply this before DNS lookup and before EVERY redirect. A client-side
// sanitized link is not sufficient: the endpoint also accepts direct POSTs.
// Keys are repeatedly decoded because URLSearchParams removes only one layer.
const PRIVATE_QUERY_KEY = /^(?:code|auth(?:orization)?code|oauthcode|accesstoken|refreshtoken|idtoken|clientsecret|clientidsecret|codeverifier|pkceverifier|codechallenge|samlrequest|samlresponse|assertion|password|passwd|session(?:id|token)?|state|csrf|jwt|bearer|apikey|secret|token|credential|signature|sig)$/u

function privateRecipeQueryKey(key) {
  let current = key
  for (let depth = 0; depth < 8; depth++) {
    // Canonicalize before parsing identity: NFKC may turn fullwidth query
    // delimiters into separators that a later URL consumer would re-parse.
    const canonical = current.normalize('NFKC')
      .replace(/[\p{Default_Ignorable_Code_Point}\p{Mark}]/gu, '')
    if (/[&=?#\u0000-\u001f\u007f]/u.test(canonical)) return true
    const folded = canonical.toLocaleLowerCase('en').replace(/[^a-z0-9]/gu, '')
    if (PRIVATE_QUERY_KEY.test(folded) ||
        /(?:token|secret|password|credential|signature|apikey|codeverifier|codechallenge|samlresponse|csrf)/u.test(folded)) return true
    if (!canonical.includes('%')) return false
    if (!/%[0-9a-fA-F]{2}/u.test(canonical)) return true
    let decoded
    try { decoded = decodeURIComponent(canonical) } catch { return true }
    if (decoded === canonical) return true
    current = decoded
  }
  return true
}

function privateNestedRecipeQuery(value) {
  let current = value
  for (let depth = 0; depth < 8; depth++) {
    const marker = current.indexOf('?')
    if (marker !== -1) {
      const query = current.slice(marker + 1).split('#', 1)[0]
      for (const key of new URLSearchParams(query).keys())
        if (privateRecipeQueryKey(key)) return true
    }
    if (!/%[0-9a-fA-F]{2}/u.test(current)) return false
    let decoded
    try { decoded = decodeURIComponent(current) } catch { return true }
    if (decoded === current) return false
    current = decoded
  }
  return true
}

export function recipeUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Ongeldige receptlink.')
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') ||
      /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new Error('Gebruik een publieke HTTPS-receptlink.')
  for (const [key, value] of url.searchParams) {
    if (privateRecipeQueryKey(key) || privateNestedRecipeQuery(value))
      throw new Error('Gebruik een openbare receptlink zonder inloggegevens.')
  }
  url.hash = ''
  return url
}

/** Validate every redirect and pin DNS to the exact public address checked. */
export async function fetchRecipeHtml(input, { resolve = lookup, request = https.request, timeout = 10_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const expired = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Het ophalen duurde te lang. Probeer opnieuw.')), { once: true }))
  async function visit(input, redirects = 0) {
    const url = recipeUrl(input)
    const addresses = await resolve(url.hostname, { all: true, family: 4 })
    if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error('Deze receptlink is niet publiek bereikbaar.')
    if (controller.signal.aborted) throw new Error('Het ophalen duurde te lang.')
    const result = await new Promise((resolve, reject) => {
      const req = request(url, {
        signal: controller.signal, agent: false,
        headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity', 'User-Agent': 'SupaRecipeImport/1.0' },
        lookup(_hostname, options, callback) {
          const entry = { address: addresses[0].address, family: 4 }
          if (options.all) callback(null, [entry]); else callback(null, entry.address, entry.family)
        },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location; res.destroy()
          if (!location || redirects >= 3) return reject(new Error('Te veel doorverwijzingen in de receptlink.'))
          return resolve({ redirect: new URL(location, url).href })
        }
        if (res.statusCode !== 200 || !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type'] ?? '')) {
          res.destroy(); return reject(new Error('Deze website geeft geen leesbare receptpagina terug. Vul het recept handmatig in.'))
        }
        let size = 0; const chunks = []
        res.on('error', reject)
        res.on('data', chunk => {
          size += chunk.length
          if (size > 512_000) { reject(new Error('De receptpagina is te groot.')); res.destroy(); return }
          chunks.push(chunk)
        })
        res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), sourceUrl: url.href }))
      })
      req.on('error', reject); req.end()
    })
    return result.redirect ? visit(result.redirect, redirects + 1) : result
  }
  try { return await Promise.race([visit(input), expired]) } finally { clearTimeout(timer) }
}
