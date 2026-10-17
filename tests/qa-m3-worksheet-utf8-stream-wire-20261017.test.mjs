/**
 * Independent M3 human worksheet byte-transport regression. Exercises the real
 * offline operator scanner with a synthetic UNOBSERVED sheet, not the producer.
 * Neither a positive scan nor this test is retailer field/savings evidence.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditPrivateWorksheetCsv, main } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

const columns = [
  'evidenceStatus', 'retailerId', 'ingredientId', 'ingredientLabel',
  'requiredAmount', 'requiredUnit', 'observedAt', 'storeLocation',
  'priceContext', 'observedProductName', 'observedPackAmount',
  'observedPackUnit', 'observedPackCount', 'observedPriceEUR',
  'observedAvailability', 'collectionMethod', 'evidenceReference', 'notes',
]
const label = 'Crème 👩‍🍳 क्‍ष'
const cell = value => '"' + value.replaceAll('"', '""') + '"'
const row = cells => cells.map(cell).join(',')
const csv = [
  row(columns),
  ...['plus', 'dekamarkt'].map(store => row([
    'UNOBSERVED_TEMPLATE_NOT_EVIDENCE', store, 'safe-one',
    label, '12.5', 'g', ...Array(12).fill(''),
  ])),
].join('\n') + '\n'
const canonical = Buffer.from(csv, 'utf8')
const expected = {
  mode: 'm3-blank-worksheet-qa-only',
  rows: 2, ingredientNeeds: 1, pairedRetailers: 2,
  verifiedActualObservations: 0, sourceRightsVerified: false,
  productionReady: false, publicSavingsClaimEligible: false,
}

async function examine(parts) {
  const writes = []
  const outcome = await main(Readable.from(parts), part => { writes.push(part) })
  assert.deepEqual(outcome, expected)
  assert.deepEqual(writes, [JSON.stringify(expected) + '\n'])
  assert.doesNotMatch(writes[0], /Crème|👩|plus|dekamarkt|safe-one|observedPriceEUR/)
}

async function refused(parts) {
  const writes = []
  await assert.rejects(main(Readable.from(parts), part => { writes.push(part) }),
    /Private worksheet QA audit refused/)
  assert.deepEqual(writes, [], 'invalid input cannot emit even partial operator summary')
}

test('real scanner accepts each valid multibyte UTF-8 sequence split across buffer chunks', async () => {
  assert.deepEqual(auditPrivateWorksheetCsv(csv), expected)
  await examine([canonical])
  await examine([csv])
  await examine([...canonical].map(byte => Buffer.from([byte])))
  const emoji = canonical.indexOf(Buffer.from('👩‍🍳', 'utf8'))
  assert.ok(emoji > 0)
  for (let split = emoji; split < emoji + Buffer.byteLength('👩‍🍳') + 1; split++) {
    await examine([canonical.subarray(0, split), canonical.subarray(split)])
  }
})

test('fatal UTF-8 rejects malformed transport encodings without lossy replacement or output', async () => {
  const emoji = Buffer.from('👩‍🍳', 'utf8')
  const start = canonical.indexOf(emoji)
  assert.ok(start > 0)
  const first = canonical.subarray(0, start)
  const last = canonical.subarray(start + emoji.length)
  const illegals = [
    [0xc0, 0xaf],               // overlong encoding
    [0xed, 0xa0, 0x80],         // encoded UTF-16 lone surrogate
    [0xf4, 0x90, 0x80, 0x80],   // beyond Unicode scalar range
    [0x80],                     // continuation without leading byte
    [0xff],                     // invalid lead
    [0xf0, 0x9f, 0x91],         // truncated four-byte emoji
    [0xe2, 0x28, 0xa1],         // invalid continuation
  ]
  for (const bytes of illegals) {
    const invalid = Buffer.concat([first, Buffer.from(bytes), last])
    await refused([invalid])
    await refused([invalid.subarray(0, start + 1), invalid.subarray(start + 1)])
  }
})

test('text chunks may not split a UTF-16 surrogate pair or smuggle a lone surrogate', async () => {
  const emoji = csv.indexOf('👩')
  assert.ok(emoji > 0)
  const left = csv.slice(0, emoji + 1)
  const right = csv.slice(emoji + 1)
  assert.equal(left.charCodeAt(left.length - 1), 0xd83d)
  await examine([csv])
  await refused([left, right])
  await refused([csv.replace('👩', '\ud83d')])
  await refused([csv.replace('👩', '\udc69')])
})

test('mixed well-formed text and byte chunks decode identically, but poison data never becomes a result', async () => {
  const idx = csv.indexOf(label)
  assert.ok(idx > 0)
  const start = csv.slice(0, idx)
  const tail = csv.slice(idx)
  await examine([start, Buffer.from(tail)])
  await refused([start, Buffer.from([0xff]), Buffer.from(tail)])
  await refused([Buffer.alloc(1_048_577, 65)])
})

test('standalone stdin CLI preserves aggregate-only stdout and refuses malformed wire bytes', () => {
  const cli = fileURLToPath(new URL('../scripts/qa-m3-private-worksheet-preflight.mjs', import.meta.url))
  const run = input => spawnSync(process.execPath, [cli], {
    input, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024,
  })
  const good = run(canonical)
  assert.equal(good.status, 0, good.stderr)
  assert.deepEqual(JSON.parse(good.stdout), expected)
  assert.equal(good.stderr, '')
  const bad = run(Buffer.concat([canonical.subarray(0, 12), Buffer.from([0xff]), canonical.subarray(12)]))
  assert.equal(bad.status, 2)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /^Private worksheet QA audit refused\s*$/)
  assert.doesNotMatch(bad.stderr, /Crème|plus|dekamarkt|safe-one/)
})


test('RFC4180 commas and doubled quotes in legitimate multilingual labels survive every wire split', async () => {
  const humanName = 'Kersen, "zoet" — crème 🧑‍🍳 क्‍ष'
  const payload = csv.replaceAll(cell(label), cell(humanName))
  const bytes = Buffer.from(payload, 'utf8')
  assert.equal(auditPrivateWorksheetCsv(payload).rows, 2)
  await examine([bytes])
  await examine([...bytes].map(byte => Buffer.from([byte])))
  const quotedLabel = Buffer.from(cell(humanName), 'utf8')
  const start = bytes.indexOf(quotedLabel)
  assert.ok(start > 0, 'actual double-quoted human ingredient cell must be present')
  for (let split = start; split <= start + quotedLabel.length; split++) {
    await examine([bytes.subarray(0, split), bytes.subarray(split)])
  }
})

test('well-formed CSV bytes with a forged human observed price must never yield a partial preflight summary', async () => {
  const observed = Array(12).fill('')
  observed[7] = '1.50' // observedPriceEUR: seventh zero-based human field after index 6
  const altered = [
    row(columns),
    row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', 'plus', 'safe-one', label, '12.5', 'g', ...observed]),
    row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', 'dekamarkt', 'safe-one', label, '12.5', 'g', ...Array(12).fill('')]),
  ].join('\n') + '\n'
  const bytes = Buffer.from(altered, 'utf8')
  assert.throws(() => auditPrivateWorksheetCsv(altered), /Private worksheet QA audit refused/)
  await refused([bytes])
  await refused([...bytes].map(byte => Buffer.from([byte])))
})


test('100 distinct private needs × 2 stores accept the exact operator limit independent of paired row ordering', async () => {
  const entries = []
  for (let index = 0; index < 100; index++) {
    const id = index === 0 ? "'-signed-ingredient" : 'safe-' + index
    const ingredient = index === 0 ? 'Zuurdesem "vóórraad" 👩‍🍳' : 'Crème ' + index + ' क्‍ष'
    const amount = (index + 1) / 10
    for (const store of ['dekamarkt', 'plus']) {
      entries.push(row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', store,
        id, ingredient, String(amount), 'g', ...Array(12).fill('')]))
    }
  }
  const asCsv = rows => [row(columns), ...rows].join('\n') + '\n'
  const canonicalCsv = asCsv(entries)
  const reference = {...expected, rows: 200, ingredientNeeds: 100}
  assert.deepEqual(auditPrivateWorksheetCsv(canonicalCsv), reference)
  assert.deepEqual(await main(Readable.from([Buffer.from(canonicalCsv)]), () => {}), reference)
  const reversedCsv = asCsv([...entries].reverse())
  assert.deepEqual(auditPrivateWorksheetCsv(reversedCsv), reference)
  const chunks = Buffer.from(reversedCsv, 'utf8')
  const outputs = []
  const byteChunks = [...chunks].map(byte => Buffer.from([byte]))
  assert.deepEqual(await main(Readable.from(byteChunks), line => outputs.push(line)), reference)
  assert.deepEqual(outputs, [JSON.stringify(reference) + '\n'])
  assert.doesNotMatch(outputs[0], /Crème|Zuurdesem|signed-ingredient|dekamarkt|plus/)
  const missing = asCsv(entries.slice(0, -1))
  await refused([Buffer.from(missing)])
  const repeated = asCsv([...entries, entries[0]])
  await refused([Buffer.from(repeated)])
  const extra = asCsv([...entries,
    row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', 'dekamarkt', 'need-101',
      'Valid extra need', '2', 'g', ...Array(12).fill('')]),
    row(['UNOBSERVED_TEMPLATE_NOT_EVIDENCE', 'plus', 'need-101',
      'Valid extra need', '2', 'g', ...Array(12).fill('')])])
  await refused([Buffer.from(extra)])
  assert.ok(Buffer.byteLength(canonicalCsv) < 1_048_576,
    'normal 100x2 bounded worksheet stays below the transport byte ceiling')
})


test('late stream failures and unsupported object chunks cannot commit an apparently valid preflight', async () => {
  await examine([canonical])
  await refused([])
  await refused([canonical, Buffer.from('PRIVATE_TAIL_SHOULD_NOT_BE_ACCEPTED')])
  await refused([canonical, '\n'])
  await refused([canonical, { toString: () => csv }])
  await refused([canonical, Uint8Array.from([65])])
  await refused([new String(csv)])
  const leaked = []
  async function* lateError() {
    yield canonical
    yield Buffer.alloc(0)
    throw new Error('synthetic late upstream stream error; not verified')
  }
  await assert.rejects(main(lateError(), fragment => leaked.push(fragment)),
    /synthetic late upstream stream error/)
  assert.deepEqual(leaked, [], 'a successful-looking prefix must not produce any operator summary')
  await assert.rejects(main(Readable.from([canonical]), null),
    /Private worksheet QA audit refused/,
    'non-function writer must be refused before reading a valid private worksheet')
})
