import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
} from '../src/domain/m3ObservationSheet.ts'
import {
  nextObservationActionLabel,
  observationPriceCents,
  observationTimestampFromDate,
} from '../src/features/observation/observationCollectionUi.ts'

test('M3 collection guidance names the exact next retailer and ingredient', () => {
  const sheet = buildObservationSheet()

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: PLUS · Basmati rijst',
  )

  sheet.baseline.lines[0].observedProduct.available = false

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: PLUS · Broccoli',
  )

  sheet.baseline.lines.forEach((line) => {
    line.observedProduct.available = false
  })

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Volgende: DekaMarkt · Basmati rijst',
  )

  sheet.candidate.lines.forEach((line) => {
    line.observedProduct.available = false
  })

  assert.equal(
    nextObservationActionLabel(sheet, nextIncompleteObservationLine(sheet)),
    'Alle regels zijn gemeten',
  )
})

test('M3 current-time helper emits ISO evidence time and fails closed for invalid dates', () => {
  assert.equal(
    observationTimestampFromDate(new Date('2026-10-06T07:45:12.345Z')),
    '2026-10-06T07:45:12.345Z',
  )
  assert.equal(observationTimestampFromDate(new Date('invalid')), '')
})

test('M3 current-time helper rejects malformed runtime value types', () => {
  for (const malformed of [null, undefined, '2026-10-06T07:45:12.345Z', 0, {}, []]) {
    assert.equal(observationTimestampFromDate(malformed), '')
  }
})

test('M3 current-time helper rejects Date-prototype spoofing and ignores poisoned instance methods', () => {
  assert.equal(observationTimestampFromDate(Object.create(Date.prototype)), '')

  const poisoned = new Date('2026-10-06T07:45:12.345Z')
  poisoned.getTime = () => {
    throw new Error('poisoned getTime')
  }
  poisoned.toISOString = () => {
    throw new Error('poisoned toISOString')
  }

  assert.equal(
    observationTimestampFromDate(poisoned),
    '2026-10-06T07:45:12.345Z',
  )
})

test('M3 observed-price helper preserves exact cents and rejects silent rounding', () => {
  assert.equal(observationPriceCents('1'), 100)
  assert.equal(observationPriceCents('1.2'), 120)
  assert.equal(observationPriceCents('1,23'), 123)
  assert.equal(observationPriceCents('.99'), 99)
  assert.equal(observationPriceCents(',99'), 99)
  assert.equal(observationPriceCents('1.'), 100)
  assert.equal(observationPriceCents('0.00'), 0)
  assert.equal(observationPriceCents(' 2,50 '), 250)

  assert.equal(observationPriceCents('1.999'), null)
  assert.equal(observationPriceCents('1,234'), null)
  assert.equal(observationPriceCents('-1.00'), null)
  assert.equal(observationPriceCents('1e2'), null)
  assert.equal(observationPriceCents(''), null)
  assert.equal(observationPriceCents('90071992547410.00'), null)
})

test('M3 observed-price helper rejects malformed runtime value types', () => {
  for (const malformed of [null, undefined, 1.23, {}, [], true]) {
    assert.equal(observationPriceCents(malformed), null)
  }
})

test('M3 collection guidance fails closed on malformed next-observation targets', () => {
  const sheet = buildObservationSheet()

  for (const malformed of [
    undefined,
    false,
    0,
    '',
    [],
    {},
    { side: 'unknown', ingredientId: 'basmati-rice' },
    { side: 'baseline', ingredientId: '' },
    { side: 'baseline', ingredientId: '   ' },
    { side: 'baseline', ingredientId: 42 },
    { side: 'baseline', ingredientId: 'missing-ingredient' },
  ]) {
    assert.throws(
      () => nextObservationActionLabel(sheet, malformed),
      /invalid next observation target/,
    )
  }
})


test('M3 collection guidance rejects malformed or duplicate line identities before claiming completion', () => {
  for (const mutate of [
    (sheet) => {
      sheet.baseline.lines[0].ingredientId = '   '
    },
    (sheet) => {
      sheet.baseline.lines[0].ingredientId =
        `${sheet.baseline.lines[0].ingredientId} `
    },
    (sheet) => {
      sheet.baseline.lines[1].ingredientId =
        sheet.baseline.lines[0].ingredientId
    },
  ]) {
    const sheet = buildObservationSheet()
    sheet.baseline.lines.forEach((line) => {
      line.observedProduct.available = false
    })
    sheet.candidate.lines.forEach((line) => {
      line.observedProduct.available = false
    })
    mutate(sheet)

    assert.throws(
      () => nextObservationActionLabel(sheet, null),
      /invalid observation sheet/,
    )
  }
})


test('M3 collection guidance rejects cross-store demand identity drift before claiming completion', () => {
  for (const mutate of [
    (sheet) => {
      sheet.candidate.lines[0].ingredientId = 'different-ingredient'
    },
    (sheet) => {
      ;[sheet.candidate.lines[0], sheet.candidate.lines[1]] = [
        sheet.candidate.lines[1],
        sheet.candidate.lines[0],
      ]
    },
  ]) {
    const sheet = buildObservationSheet()
    sheet.baseline.lines.forEach((line) => {
      line.observedProduct.available = false
    })
    sheet.candidate.lines.forEach((line) => {
      line.observedProduct.available = false
    })
    mutate(sheet)

    assert.throws(
      () => nextObservationActionLabel(sheet, null),
      /invalid observation sheet: demand identity mismatch/,
    )
  }
})
