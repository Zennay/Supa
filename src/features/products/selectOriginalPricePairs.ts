/** Keep filtered exports tied to the original admitted comparison identity.
 * A filter is never authority to add/approve source prices, or infer an
 * unobserved store. Selection order follows the visible user search results.
 */
export function selectOriginalPricePairs<T extends { ingredientId: string }>(
  admitted: readonly T[],
  selectedIds?: readonly string[],
): T[] {
  if (!selectedIds) return [...admitted]
  if (!Array.isArray(selectedIds) || selectedIds.length === 0 ||
      selectedIds.length > 1000 || selectedIds.some(id =>
        typeof id !== 'string' || id.length === 0)) {
    throw new Error('Er zijn geen geldige geselecteerde winkelprijsregels.')
  }
  const selected = new Set(selectedIds)
  if (selected.size !== selectedIds.length)
    throw new Error('De productselectie bevat dubbele ingrediëntregels.')
  const byId = new Map(admitted.map(pair => [pair.ingredientId, pair]))
  if (byId.size !== admitted.length)
    throw new Error('De oorspronkelijke prijsvergelijking bevat dubbele ingrediënten.')
  return selectedIds.map(id => {
    const matched = byId.get(id)
    if (!matched)
      throw new Error('De gefilterde bronprijs is gewijzigd of verlopen. Selecteer opnieuw.')
    return matched
  })
}
