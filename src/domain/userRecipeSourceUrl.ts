/**
 * Pure URL admission for a *preview* of a recipe import request.
 * Passing this check never grants fetch permission. A server must separately
 * validate every DNS result + connected IP on each HTTPS redirect, enforce size,
 * MIME, time and authorization budgets, and block cookies/credentials.
 */
export type RecipeUrlAssessment =
  | { accepted: true; normalizedUrl: string; fetchReady: false }
  | { accepted: false; reason: 'invalid_url' | 'unsafe_host' | 'credentialed_url' | 'unsupported_port' | 'too_long' }

const MAX_URL_LENGTH = 2048
const forbiddenSuffixes = [
  'localhost', 'local', 'internal', 'onion', 'lan', 'home.arpa',
  'test', 'invalid', 'example', 'corp',
]
const privateQueryKeys = new Set([
  'token', 'access_token', 'refresh_token', 'id_token', 'api_key',
  'apikey', 'client_secret', 'authorization', 'auth', 'password',
  'passwd', 'secret', 'session', 'sessionid', 'code',
])

/**
 * Only prepares a public-looking HTTPS domain for user preview.
 * Never pass normalizedUrl to an unrestricted browser/server fetch.
 */
export function assessRecipeSourceUrl(value: unknown): RecipeUrlAssessment {
  if (typeof value !== 'string' || value.length === 0) return { accepted: false, reason: 'invalid_url' }
  if (value.length > MAX_URL_LENGTH) return { accepted: false, reason: 'too_long' }
  if (value.trim() !== value || /[\u0000-\u001F\u007F\\]/.test(value)) {
    return { accepted: false, reason: 'invalid_url' }
  }
  if (!/^https:\/\//i.test(value)) return { accepted: false, reason: 'invalid_url' }

  // Refuse obfuscated authorities rather than silently changing their meaning.
  const authority = value.slice('https://'.length).split(/[/?#]/, 1)[0]
  if (!authority || /[%\s]/.test(authority)) return { accepted: false, reason: 'unsafe_host' }

  let parsed: URL
  try { parsed = new URL(value) } catch { return { accepted: false, reason: 'invalid_url' } }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return { accepted: false, reason: parsed.username || parsed.password ? 'credentialed_url' : 'invalid_url' }
  }
  if (parsed.port && parsed.port !== '443') return { accepted: false, reason: 'unsupported_port' }
  const hostname = parsed.hostname.toLowerCase()
  // IP literals are refused, even publicly routable ones: DNS safety belongs
  // to the HTTPS server fetch boundary, not to string parsing.
  if (!hostname || hostname.length > 253 || hostname.endsWith('.') ||
      hostname.startsWith('[') || /^[0-9.]+$/.test(hostname) ||
      !hostname.includes('.') || !/^[a-z0-9.-]+$/.test(hostname) ||
      hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      forbiddenSuffixes.some((suffix) => hostname === suffix || hostname.endsWith('.' + suffix))) {
    return { accepted: false, reason: 'unsafe_host' }
  }
  // Host aliases and credential-like query parameters must not silently carry
  // user secrets into a future server-side downloader or a diagnostic log.
  for (const key of parsed.searchParams.keys()) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (key.includes('%') || privateQueryKeys.has(key.toLowerCase()) || privateQueryKeys.has(normalized) ||
        /(?:token|secret|password|session|apikey|authorization)/.test(normalized)) {
      return { accepted: false, reason: 'credentialed_url' }
    }
  }
  parsed.hash = ''
  return { accepted: true, normalizedUrl: parsed.toString(), fetchReady: false }
}
