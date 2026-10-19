/**
 * A source link is attribution, never an authorization token or a required
 * live price input. Preserve ordinary recipe query parameters, but never copy
 * login / PKCE / OAuth / SAML credentials into a portable recipe backup.
 */
const SECRET_KEYS = /^(?:code|auth(?:orization)?code|oauthcode|accesstoken|refreshtoken|idtoken|clientsecret|clientidsecret|codeverifier|pkceverifier|codechallenge|samlrequest|samlresponse|assertion|password|passwd|session(?:id|token)?|state|csrf|jwt|bearer|apikey|secret|token|credential|signature|sig)$/u

function queryKeyNeedsRemoval(key: string): boolean {
  let decoded = key
  for (let i = 0; i < 8; i++) {
    const normalized = decoded.normalize('NFKC')
      .replace(/[\p{Default_Ignorable_Code_Point}\p{Mark}]/gu, '')
      .toLocaleLowerCase('en')
      .replace(/[^a-z0-9]/gu, '')
    if (SECRET_KEYS.test(normalized)) return true
    if (!/%[0-9a-fA-F]{2}/.test(decoded)) return false
    let next: string
    try { next = decodeURIComponent(decoded) } catch { return true }
    if (next === decoded) return false
    decoded = next
  }
  // Unresolved nesting is not safe to emit to another device.
  return decoded.includes('%')
}

/**
 * Nested redirect/callback links sometimes hide an OAuth code in the VALUE
 * of an innocent-looking query key. Remove that entire parameter before
 * storing, exporting or sending the public recipe page to our server.
 */
function nestedRecipeQueryNeedsRemoval(value: string): boolean {
  let decoded = value
  for (let depth = 0; depth < 8; depth++) {
    const marker = decoded.indexOf('?')
    if (marker !== -1) {
      const query = decoded.slice(marker + 1).split('#', 1)[0]
      if ([...new URLSearchParams(query).keys()].some(queryKeyNeedsRemoval)) return true
    }
    if (!/%[0-9a-fA-F]{2}/u.test(decoded)) return false
    let next: string
    try { next = decodeURIComponent(decoded) } catch { return true }
    if (next === decoded) return false
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
