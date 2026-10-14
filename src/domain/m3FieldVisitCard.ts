import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
  type M3ObservationSide,
} from './m3ObservationSheet.ts'

export type M3FieldVisitSelection = M3ObservationSide | 'both'

function quantityLabel(amount: number, unit: string): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('invalid canonical ingredient quantity')
  }

  // Keep the source-of-truth decimal intact: a display helper must not round
  // a future fractional shopping requirement into a different demand.
  const number = String(amount).replace('.', ',')
  if (unit === 'piece') return `${number} ${amount === 1 ? 'stuk' : 'stuks'}`
  if (['g', 'kg', 'ml', 'l'].includes(unit)) return `${number} ${unit}`
  throw new Error('invalid canonical ingredient unit')
}

/**
 * Generates a printable, blank, privacy-safe M3 collection aid.
 *
 * This is NOT field evidence. It deliberately does not accept observation data,
 * retailer prices or participant details. The JSON observation sheet remains the
 * canonical entry point for actual capture, conversion and assessment.
 */
export function renderM3FieldVisitCard(
  selection: M3FieldVisitSelection = 'both',
): string {
  if (selection !== 'both' && selection !== 'baseline' && selection !== 'candidate') {
    throw new Error('unknown M3 field visit selection')
  }

  const sheet = buildObservationSheet()
  const sides: M3ObservationSide[] =
    selection === 'both' ? ['baseline', 'candidate'] : [selection]

  const text: string[] = [
    '# SUPA M3 — Veldkaart (leeg sjabloon; GEEN bewijs)',
    '',
    'Dit is een hulpmiddel om dezelfde boodschappen bij twee winkels te controleren.',
    'Vul nooit een prijs of beschikbaarheid in op basis van een aanname.',
    'Een ingevulde veldkaart is GEEN geldige besparingsmeting: voer de observaties in',
    'het officiële M3-observatieblad in en doorloop daarna converter en assessment.',
    '',
    'Studie-ID: ____________________',
    'Pseudonieme deelnemercode (geen naam/e-mail): ____________________',
    'Doelgroep: ____________________',
    'Regio: ____________________   Week start: ____________________',
    'Kies ÉÉN prijscontext voor beide winkels: [ ] winkel  [ ] online bestelling',
    'Vergelijk dezelfde vraagset; noteer beide metingen binnen maximaal 24 uur.',
    'Onbekend of niet verkrijgbaar blijft onbekend; geen vervangende prijs verzinnen.',
    'Bij nee/onbekend: laat product, verpakking en prijs leeg; hergebruik geen oude waarden.',
    'Onbekend is niet hetzelfde als nee: een ongemeten regel is nog niet klaar voor conversie.',
  ]

  for (const side of sides) {
    const store = M3_EXPECTED_RETAILERS[side]
    text.push(
      '',
      `## ${store} — ${side === 'baseline' ? 'eerste winkel' : 'vergelijkwinkel'}`,
      'Winkelnaam (zoals waargenomen): ____________________',
      'Winkel-ID (zelfgekozen unieke code; geen klantnummer): ____________________',
      'Filiaal of bestelcontext: ____________________',
      'Waargenomen op (datum, tijd en tijdzone): ____________________',
      'Bron: [ ] handmatige mand  [ ] kassabon  [ ] export met toestemming',
      'Bewijs-ID (uniek per meting, zonder persoonsgegevens): ____________________',
      'Herkomstnotitie (wat, waar en hoe gecontroleerd): ____________________',
      `Benodigd: ${sheet.requirements.length} vaste ingrediënten uit de M2-weekplanning.`,
    )

    for (const [index, requirement] of sheet.requirements.entries()) {
      text.push(
        '',
        `${index + 1}. ${requirement.label} — nodig: ${quantityLabel(requirement.amount, requirement.unit)}`,
        '   Verkrijgbaar: [ ] ja  [ ] nee  [ ] onbekend',
        '   Gezien product + merk: __________________________________________',
        '   Verpakkingsinhoud (hoeveelheid + g/kg/ml/l/stuk): ______________',
        '   Aantal stuks in verkooppakket (multipack; 1 bij enkelpak): ____',
        '   Prijs per verpakking (EUR): ________   Aanbieding/bron: ________',
      )
    }
  }

  text.push(
    '',
    'Na het winkelbezoek: vul de officiële M3 JSON-observatie in; verifieer beide',
    'winkelidentiteiten, tijdvenster, prijscontext en alle ontbrekende regels.',
    'Beoordeel ook gelijke, hogere of onbekende kosten; rapporteer niet alleen voordeel.',
    'De actuele M3-uitkomst is onbeslist totdat echte observaties zijn beoordeeld.',
    '',
  )

  return text.join('\n')
}
