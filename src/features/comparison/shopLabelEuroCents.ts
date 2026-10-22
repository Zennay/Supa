/**
 * Interpret a user-typed price from a physical euro shelf label.
 * This is an arithmetic format converter, NEVER a source observation.
 * No floating point, guessing about thousands separators, or rounding.
 * For the existing strict private source importer prices remain whole cents.
 */
export function shopLabelEuroCents(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 32)
    throw Error('Vul de werkelijk waargenomen europrijs kort en volledig in.')
  const clean = raw.trim().replace(/^€\s*/u, '')
  const parts = /^(0|[1-9]\d{0,4})(?:([,.])(\d{2}))?$/u.exec(clean)
  if (!parts)
    throw Error('Gebruik een exacte winkelprijs zoals € 1,99 of 0,00. Geen duizendtallen, afronding of geschatte bedragen.')
  const euros = BigInt(parts[1])
  const cents = BigInt(parts[3] ?? '00')
  const amount = euros * 100n + cents
  if (amount > 1_000_000n)
    throw Error('Een originele winkelpakprijs mag maximaal € 10.000,00 zijn.')
  return amount.toString()
}
