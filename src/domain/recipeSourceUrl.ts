/**
 * Shared public recipe-source URL admission, adapted from the existing private
 * backup product-owner code (#3676). Browser input, saved library, import
 * and remote-fetch preflight all use the same bounded query-key privacy rule.
 * Only HTTPS provenance metadata; this does not grant fetch permission.
 */
export function safeRecipeSourceUrl(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Ongeldige publieke receptbronlink.')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Ongeldige publieke receptbronlink.') }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) ||
      /^(?:\d+\.){3}\d+$/.test(url.hostname)) {
    throw new Error('Alleen publieke HTTPS-receptlinks zijn toegestaan.')
  }
  for (const encodedKey of url.searchParams.keys()) {
    // URLSearchParams performs ONE percent decoding pass. A further-escaped
    // OAuth/PKCE/SAML key must never escape into a portable JSON backup.
    // Every pass is checked; still-escaped, malformed or excessive nesting
    // fails closed without including a source URL or any query value in errors.
    let key = encodedKey
    let resolved = false
    for (let layer = 0; layer < 8; layer += 1) {
      // Percent-encoded query delimiters can become an entirely new auth
      // parameter if a downstream importer or link resolver decodes again.
      // Reject that ambiguity, including control characters, instead of
      // serializing a portable URL that changes meaning across applications.
      const canonical = key.normalize('NFKC')
      // Fullwidth/compatibility Unicode becomes ASCII delimiters and percent
      // escapes AFTER normalization. Never evaluate source URL query safety on
      // the pre-normalized text (it could gain a new OAuth query parameter).
      // Reject all default-ignorable Unicode characters (including Mn
      // grapheme joiners and variation selectors, not just Cc/Cf) in
      // QUERY KEYS before each decode. Downstream canonicalizers may strip
      // these characters and reinterpret e.g. co<ignorable>de as 'code'.
      // Such keys can display as a harmless label while resolving to an auth
      // field when a downstream app removes default-ignorable markers.
      // Query VALUES (including human recipe names) are not affected.
      if (/[&=?#\p{Default_Ignorable_Code_Point}\p{Cc}]/u.test(canonical)) {
        throw new Error('Receptbronlink bevat onveilige tekens.')
      }
      const normalized = canonical.toLowerCase()
      const compact = normalized.replace(/[-_\s]/g, '')
      if (/(?:oauth|saml|token|secret|password|signature|apikey|session|authorization|pkce|codeverifier|codechallenge|authcode)/.test(compact) ||
          /(?:^|[_-])(?:code|sig|auth|state)(?:$|[_-])/.test(normalized)) {
        throw new Error('Receptlink mag geen inloggegevens bevatten.')
      }
      // Decode the canonical version: NFKC can itself produce a fresh %
      // escape from a fullwidth percent sign (U+FF05).
      if (!canonical.includes('%')) {
        resolved = true
        break
      }
      let decoded: string
      try {
        decoded = decodeURIComponent(canonical)
      } catch {
        throw new Error('Receptbronlink bevat onveilige tekens.')
      }
      if (decoded === canonical) {
        throw new Error('Receptbronlink bevat onveilige tekens.')
      }
      key = decoded
    }
    if (!resolved) throw new Error('Receptbronlink bevat onveilige tekens.')
  }
  url.hash = ''
  return url.href
}

