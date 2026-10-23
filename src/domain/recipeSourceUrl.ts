/**
 * A source link is attribution, never an authorization token or a required
 * live price input. Preserve ordinary recipe query parameters, but never copy
 * login / PKCE / OAuth / SAML credentials into a portable recipe backup.
 */
const SECRET_KEYS = /^(?:code|auth(?:orization)?code|oauthcode|accesstoken|refreshtoken|idtoken|clientsecret|clientidsecret|codeverifier|pkceverifier|codechallenge|samlrequest|samlresponse|assertion|password|passwd|session(?:id|token)?|state|csrf|jwt|bearer|apikey|secret|token|credential|signature|sig)$/u
const URL_CONTROL_OR_DELIMITER = /[&=?#\u0000-\u001f\u007f]/u
const COMPATIBILITY_NOISE = /[\p{Default_Ignorable_Code_Point}\p{Mark}]/gu

function queryKeyNeedsRemoval(key: string): boolean {
  let decoded = key
  for (let i = 0; i < 8; i++) {
    // Normalize BEFORE inspecting structure. NFKC can turn fullwidth ＆＝？＃％
    // into query delimiters or percent escapes that another URL parser sees.
    const canonical = decoded.normalize('NFKC').replace(COMPATIBILITY_NOISE, '')
    if (URL_CONTROL_OR_DELIMITER.test(canonical)) return true
    const normalized = canonical.toLocaleLowerCase('en').replace(/[^a-z0-9]/gu, '')
    if (SECRET_KEYS.test(normalized)) return true
    if (!canonical.includes('%')) return false
    // A literal or malformed percent in a query key is ambiguous at a later
    // decoding boundary. Valid nested escapes are decoded from canonical text.
    if (!/%[0-9a-fA-F]{2}/u.test(canonical)) return true
    let next: string
    try { next = decodeURIComponent(canonical) } catch { return true }
    if (next === canonical) return true
    decoded = next
  }
  // Eight decode layers is the limit; never emit a key we did not fully inspect.
  return true
}

/**
 * Nested redirect/callback links sometimes hide an OAuth code in the VALUE
 * of an innocent-looking query key. Remove that entire parameter before
 * storing, exporting or sending the public recipe page to our server.
 */
function nestedRecipeQueryNeedsRemoval(value: string): boolean {
  let decoded = value
  for (let depth = 0; depth < 8; depth++) {
    // Canonicalize only for admission. The stored link remains unchanged unless
    // its risky parameter is removed by safeRecipeSourceUrl below.
    const canonical = decoded.normalize('NFKC').replace(COMPATIBILITY_NOISE, '')
    const marker = canonical.indexOf('?')
    if (marker !== -1) {
      const query = canonical.slice(marker + 1).split('#', 1)[0]
      if ([...new URLSearchParams(query).keys()].some(queryKeyNeedsRemoval)) return true
    }
    if (!canonical.includes('%')) return false
    if (!/%[0-9a-fA-F]{2}/u.test(canonical)) return true
    let next: string
    try { next = decodeURIComponent(canonical) } catch { return true }
    if (next === canonical) return true
    decoded = next
  }
  return true
}

export function safeRecipeSourceUrl(input: string): string {
  let url: URL
  try { url = new URL(input) }
  catch { throw new Error('Ongeldige receptbron. Controleer de HTTPS-link.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.toString().length > 4096) {
    throw new Error('Alleen openbare HTTPS-receptbronnen zonder accountgegevens zijn toegestaan.')
  }
  url.hash = ''
  const kept: [string, string][] = []
  for (const [key, value] of url.searchParams) {
    if (!queryKeyNeedsRemoval(key) && !nestedRecipeQueryNeedsRemoval(value)) kept.push([key, value])
  }
  url.search = ''
  for (const [key, value] of kept) url.searchParams.append(key, value)
  return url.toString()
}
