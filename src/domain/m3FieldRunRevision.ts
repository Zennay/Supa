/**
 * An M3 field run must identify the exact reviewed code revision used when
 * collection started. This value is provided by the operator/field evidence;
 * it must never be synthesized from process.env or the current checkout.
 *
 * Issue #205: opt-in validation helper until source owners integrate collector
 * (#154), converter (#156) and assessor/report (#128).
 */

export const M3_FIELD_RUN_REVISION_KEY = 'fieldRunCommitSha' as const

export type M3FieldRunRevision = Readonly<{
  fieldRunCommitSha: string
}>

export function parseM3FieldRunCommitSha(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
    ? value
    : null
}

/**
 * Use at the field-sheet/converter trust boundary. The generic error carries
 * neither participant identity nor other observation data into a CI log.
 */
export function requireM3FieldRunCommitSha(study: unknown): string {
  if (!study || typeof study !== 'object' || Array.isArray(study)) {
    throw new Error('M3 field-run code revision missing or invalid')
  }

  const sha = parseM3FieldRunCommitSha(
    (study as Record<string, unknown>)[M3_FIELD_RUN_REVISION_KEY],
  )

  if (sha === null) {
    throw new Error('M3 field-run code revision missing or invalid')
  }

  return sha
}

/**
 * Whitelisted metadata for a privacy-safe report. No other study fields or
 * participant data are copied and no runtime HEAD lookup is performed.
 */
export function m3FieldRunRevisionForReport(
  study: unknown,
): M3FieldRunRevision {
  return { fieldRunCommitSha: requireM3FieldRunCommitSha(study) }
}
