export const euro = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
})

export function savings(baseline: number, total: number) {
  return Math.max(0, baseline - total)
}
