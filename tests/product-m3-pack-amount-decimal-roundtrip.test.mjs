import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

// Own product acceptance of the actual shipped TSX parser, not a copied
// JavaScript implementation. All quantities are synthetic, not store evidence.
test('M3 pack quantity never saves an IEEE-754-rounded user decimal', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const {
      observationFinalPackAmount: parse,
      observationEditablePackAmount: display,
      observationPackAmountEditDecision: decide,
    } = await vite.ssrLoadModule('/src/features/observation/ObservationPackAmountInput.tsx')

    // Original defect: Number() silently truncates meaningful decimal digits,
    // even though the UI promises no rounding of human-observed pack sizes.
    for (const typed of [
      '1,0000000000000001',
      '2.9999999999999999',
      '1.234567890123456789',
      '9007199254740990,5',
      '0.0000000000000000000000001234',
    ]) {
      assert.equal(parse(typed), null, `refuse rounded physical quantity ${typed}`)
      assert.deepEqual(decide(typed), { kind: 'reject' },
        'the previous observed physical amount must remain unchanged')
    }

    for (const [typed, accepted] of [
      ['0,75', 0.75],
      ['0002,5000', 2.5],
      ['.125', 0.125],
      [',125', 0.125],
      ['000.00007', 0.00007],
      ['1,2345678901', 1.2345678901],
      ['9007199254740991', Number.MAX_SAFE_INTEGER],
      ['0.000000000000000000000000123', 1.23e-25],
    ]) {
      assert.equal(parse(typed), accepted, `keep valid decimal ${typed}`)
      assert.deepEqual(decide(typed), { kind: 'accept', value: accepted })
      assert.equal(parse(display(accepted)), accepted,
        'focus then blur of a previously saved valid amount must be lossless')
    }

    assert.deepEqual(decide(''), { kind: 'accept', value: null },
      'an explicitly cleared observation still clears its saved value')
    for (const invalid of ['1e3', '-2', '2,', '1.000,50', '0', 'Infinity']) {
      assert.equal(parse(invalid), null)
      assert.deepEqual(decide(invalid), { kind: 'reject' })
    }
  } finally {
    await vite.close()
  }
})
