/** Human-readable advisory; the existing strict 7-day/24-hour admission gates
 * remain the sole source of monetary-comparison authority. */
export function privatePriceAgeNotice(capturedMs: number, nowMs: number): string | null {
  const elapsed = nowMs - capturedMs
  if (!Number.isFinite(elapsed) || elapsed < -300000 || elapsed > 7 * 86400000)
    return 'De bronopname valt buiten het toegestane tijdvenster. Open Vergelijk om opnieuw op te nemen.'
  if (elapsed < 86400000) return null
  const days = Math.floor(elapsed / 86400000)
  return days + (days === 1 ? ' dag' : ' dagen') +
    ' sinds je eigen opname. Vergelijking is alleen indicatief; controleer de werkelijke winkelprijs opnieuw vóór aankoop.'
}
