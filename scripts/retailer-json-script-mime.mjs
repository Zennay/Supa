/**
 * Shared exact MIME admission for source-bound JSON script evidence.
 * A missing type stays absent for historical Nuxt/Next compatibility.
 * A present ambiguous/unsupported JSON MIME fails closed.
 */
export function admittedJsonScriptType(raw) {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') return null
  const type = raw.trim().toLowerCase()
  if (!type.startsWith('application/ld+json') &&
      !type.startsWith('application/json')) return type
  const match = /^(application\/(?:ld\+json|json))(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"|'utf-8'))?$/.exec(type)
  return match ? match[1] : null
}
