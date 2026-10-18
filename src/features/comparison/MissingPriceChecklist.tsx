import { useMemo, useState } from 'react'
import type { OneStoreBasket } from '../../domain/basket.ts'

// A small private operator handoff, not a scrape or evidence record.
type Store = 'PLUS' | 'DekaMarkt'
function readable(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 160) || 'Naam onbekend'
}
function quantity(amount: number | null, unit: string): string {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return 'hoeveelheid onbekend'
  return String(amount).replace('.', ',') + ' ' + unit
}

/** What exactly must the user find in their own next authorized source visit? */
export function MissingPriceChecklist({
  plus, deka, plusObservedAt, dekaObservedAt,
}: {
  plus: OneStoreBasket
  deka: OneStoreBasket
  plusObservedAt: string
  dekaObservedAt: string
}) {
  const [message, setMessage] = useState('')
  const missing = useMemo(() => {
    const plusById = new Map(plus.lines.map(line => [line.id, line] as const))
    const dekaById = new Map(deka.lines.map(line => [line.id, line] as const))
    const ids = new Set([...plusById.keys(), ...dekaById.keys()])
    return [...ids].flatMap(id => {
      const a = plusById.get(id)
      const b = dekaById.get(id)
      const stores: Store[] = []
      if (!a || a.status !== 'matched') stores.push('PLUS')
      if (!b || b.status !== 'matched') stores.push('DekaMarkt')
      if (!stores.length) return []
      const line = a ?? b
      if (!line) return []
      return [{
        id: readable(id), label: readable(line.ingredientLabel),
        needed: quantity(line.requirement.amount, line.requirement.unit),
        stores,
      }]
    })
  }, [plus, deka])

  const missingPlus = missing.filter(row => row.stores.includes('PLUS')).length
  const missingDeka = missing.filter(row => row.stores.includes('DekaMarkt')).length
  const download = () => {
    try {
      if (!missing.length || missing.length > 1000) throw new Error('Onvolledige lijst')
      const lines = [
        'SUPA - ONTBREKENDE PRODUCTKOPPELINGEN BIJ EIGEN WINKELBRONNEN',
        'PRIVE WERKBLAD - GEEN PRIJS, TOESTEMMING OF VELDBEWIJS',
        'Deel deze lijst niet als geverifieerde winkelvergelijking.',
        'Bron PLUS: ' + readable(plusObservedAt),
        'Bron DekaMarkt: ' + readable(dekaObservedAt),
        '',
        'Controleer de ontbrekende winkelproducten in een eigen rechtmatig beschikbare bron.',
        'Leg pas na echte waarneming productnaam, originele artikel-ID, verpakking,',
        'beschikbaarheid, bronmoment en prijs vast. Ontbrekende prijs blijft onbekend.',
        'De twee originele observatiemomenten moeten binnen 24 uur vallen voor',
        'een vergelijkbare volledige privémand. Voeg niets automatisch toe.',
        '',
        ...missing.flatMap((row, index) => [
          (index + 1) + '. ' + row.label + ' (lokaal ingrediënt: ' + row.id + ')',
          '    Benodigd: ' + row.needed,
          '    Ontbreekt bij: ' + row.stores.join(' en '),
          '    Nog te onderzoeken: artikel-ID, echte verpakking, hele prijs en beschikbaarheid.',
        ]),
        '',
        'Dit is een invulhulp op basis van jouw Planner en lokale bronbestanden.',
        'Geen geverifieerde actuele winkelprijs of publieke besparingsclaim.',
      ]
      const text = lines.join('\n') + '\n'
      if (new TextEncoder().encode(text).length > 256_000) {
        throw new Error('Te veel ontbrekende producten voor één lijst')
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'supa-ontbrekende-producten-prive.txt'
        document.body.append(link)
        link.click()
        link.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setMessage('Je lijst met ontbrekende producten is lokaal gedownload.')
    } catch {
      setMessage('Lijst niet opgeslagen. Controleer de bronbestanden of je planning.')
    }
  }

  if (!missing.length) return null
  return <section className="offline-missing-checklist" aria-label="Nog te verzamelen winkelproducten">
    <div>
      <h4>Welke producten mis je nog voor twee complete mandjes?</h4>
      <p>Er missen nog {missingPlus} PLUS-koppelingen en {missingDeka} DekaMarkt-koppelingen
        voor {missing.length} geplande ingrediënten.</p>
      <p className="disclaimer">De lijst bevat alleen ontbrekende artikelen,
        de echte benodigde hoeveelheid uit Planner en de winkels waar je nog een product
        moet beoordelen. Er worden geen ontbrekende prijzen ingevuld.</p>
    </div>
    <button type="button" className="ghost-button" onClick={download}>
      Download alleen ontbrekende producten (TXT)
    </button>
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>
}
