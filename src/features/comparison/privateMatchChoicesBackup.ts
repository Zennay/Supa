import type { OneStoreBasket, StoreProduct } from '../../domain/basket.ts'

type Store = 'PLUS' | 'DekaMarkt'
type Baskets = { PLUS: OneStoreBasket; DekaMarkt: OneStoreBasket }
type Catalogs = { PLUS: StoreProduct[]; DekaMarkt: StoreProduct[] }
type Choice = [Store, string, string]
const SCHEMA = 'supa-private-manual-matches-v1'
const MAX_BYTES = 128_000
const stores: readonly Store[] = ['PLUS', 'DekaMarkt']

/** Bind privately reviewed choices to the exact source products, prices and
 * current week. No saved retailer prices, source rights or public savings. */
async function scopeDigest(fingerprint: string): Promise<string> {
  if (!fingerprint || !globalThis.crypto?.subtle) {
    throw new Error('Deze privébackup vereist de beveiligde HTTPS-browseromgeving.')
  }
  const bytes = new TextEncoder().encode(fingerprint)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
}

function verifiedChoices(input: unknown, baskets: Baskets, catalogs: Catalogs): Record<string, string> {
  if (!Array.isArray(input) || input.length > 2000) throw new Error('Te veel productkeuzes.')
  const result: Record<string, string> = Object.create(null)
  const validLines = {
    PLUS: new Set(baskets.PLUS.lines.map(line => line.id)),
    DekaMarkt: new Set(baskets.DekaMarkt.lines.map(line => line.id)),
  }
  const validProducts = {
    PLUS: new Set(catalogs.PLUS.filter(p => p.available).map(p => p.id)),
    DekaMarkt: new Set(catalogs.DekaMarkt.filter(p => p.available).map(p => p.id)),
  }
  for (const row of input) {
    if (!Array.isArray(row) || row.length !== 3) throw new Error('Ongeldige productkeuze.')
    const [store, ingredientId, productId] = row as Choice
    if (!stores.includes(store) || typeof ingredientId !== 'string' ||
        !ingredientId || ingredientId.length > 400 || ingredientId.includes('\u0000') ||
        typeof productId !== 'string' || !productId || productId.length > 400 ||
        !validLines[store].has(ingredientId) ||
        (productId !== '!' && !validProducts[store].has(productId))) {
      throw new Error('De backup verwijst naar ontbrekende of onbekende winkelproducten.')
    }
    const key = store + '\u0000' + ingredientId
    if (Object.hasOwn(result, key)) throw new Error('Dubbele productkeuze in backup.')
    result[key] = productId
  }
  return result
}

export async function createPrivateMatchBackup(
  fingerprint: string, choices: Readonly<Record<string, string>>,
  baskets: Baskets, catalogs: Catalogs,
): Promise<string> {
  const entries: Choice[] = Object.entries(choices).map(([key, productId]) => {
    const parts = key.split('\u0000')
    if (parts.length !== 2) throw new Error('Onbekende productkeuze in deze sessie.')
    return [parts[0] as Store, parts[1], productId]
  })
  verifiedChoices(entries, baskets, catalogs)
  const data = JSON.stringify({
    schema: SCHEMA, scopeSha256: await scopeDigest(fingerprint), choices: entries,
  }, null, 2) + '\n'
  if (new TextEncoder().encode(data).byteLength > MAX_BYTES) {
    throw new Error('Te veel productkeuzes voor deze backup.')
  }
  return data
}

export async function readPrivateMatchBackup(
  raw: string, fingerprint: string, baskets: Baskets, catalogs: Catalogs,
): Promise<Record<string, string>> {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
    throw new Error('Kies een privéproductkeuzebackup van maximaal 128 kB.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('Dit is geen geldige productkeuzebackup.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Onbekende productkeuzebackup.')
  }
  const data = parsed as Record<string, unknown>
  if (Object.keys(data).some(k => !['schema', 'scopeSha256', 'choices'].includes(k)) ||
      data.schema !== SCHEMA || typeof data.scopeSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.scopeSha256)) {
    throw new Error('Onbekende versie of ongeldige productkeuzebackup.')
  }
  if (data.scopeSha256 !== await scopeDigest(fingerprint)) {
    throw new Error('De bronopnames of Planner zijn veranderd. Productkeuzes worden niet overgenomen.')
  }
  return verifiedChoices(data.choices, baskets, catalogs)
}
