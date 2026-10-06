import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  inspectCaptureDirectory,
  inspectHtml,
} from '../scripts/m1-inspect-captures.mjs'

test('inspects generic structured data without source selectors', () => {
  const html = `<!doctype html>
  <html>
    <head>
      <title>Example product</title>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"Milk","offers":{"@type":"Offer","price":"1.29"}}
      </script>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>
    </head>
    <body></body>
  </html>`

  const result = inspectHtml(html)
  assert.equal(result.title, 'Example product')
  assert.equal(result.hasNextData, true)
  assert.equal(result.jsonLd.length, 1)
  assert.deepEqual(result.jsonLd[0].type, ['Product'])
  assert.ok(result.jsonLd[0].keys.includes('offers'))
  assert.deepEqual(result.applicationJsonScripts, [
    { id: '__NEXT_DATA__', bytes: 26 },
  ])
})

test('verifies captured HTML against manifest SHA-256', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-'))
  const supermarketDir = path.join(root, 'ah')
  await mkdir(supermarketDir, { recursive: true })

  const html = '<html><head><title>Milk</title></head><body></body></html>'
  const digest = createHash('sha256').update(html).digest('hex')
  await writeFile(
    path.join(supermarketDir, 'ah-product.html'),
    html,
    'utf8',
  )

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      startedAt: '2026-10-04T00:00:00.000Z',
      completedAt: '2026-10-04T00:01:00.000Z',
      sourceCount: 1,
      successCount: 1,
      failureCount: 0,
      results: [
        {
          id: 'ah-product',
          supermarket: 'ah',
          kind: 'product',
          requestedUrl: 'https://www.ah.nl/producten/product/example',
          finalUrl: 'https://www.ah.nl/producten/product/example',
          capturedAt: '2026-10-04T00:00:30.000Z',
          sha256: digest,
          success: true,
        },
      ],
    }),
    'utf8',
  )

  const report = await inspectCaptureDirectory(root)
  assert.equal(report.integrityVerifiedCount, 1)
  assert.equal(report.sources[0].integrity, 'verified')
  assert.equal(report.sources[0].html.title, 'Milk')
  assert.equal(report.sources[0].schemaOrgProduct.type, 'abstain')
})

test('fails loudly on capture hash mismatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-bad-'))
  const supermarketDir = path.join(root, 'plus')
  await mkdir(supermarketDir, { recursive: true })
  await writeFile(
    path.join(supermarketDir, 'plus-product.html'),
    '<html></html>',
    'utf8',
  )

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 1,
      results: [
        {
          id: 'plus-product',
          supermarket: 'plus',
          kind: 'product',
          requestedUrl: 'https://www.plus.nl/product/example',
          capturedAt: '2026-10-04T00:00:00.000Z',
          sha256: 'a'.repeat(64),
          success: true,
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /integrity mismatch/,
  )
})


test('rejects unsafe source ids before resolving capture file paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-id-'))

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 1,
      results: [
        {
          id: '../outside',
          supermarket: 'plus',
          kind: 'product',
          success: true,
          sha256: 'a'.repeat(64),
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /Unsafe capture source id/,
  )
})

test('rejects unsafe supermarket path segments before reading HTML', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-store-'))

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 1,
      results: [
        {
          id: 'plus-product',
          supermarket: '..',
          kind: 'product',
          success: true,
          sha256: 'a'.repeat(64),
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /Unsafe capture supermarket path segment/,
  )
})


test('rejects non-boolean capture success flags before inspecting artifacts', async () => {
  for (const success of ['false', 1, {}, []]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-success-'))

    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        milestone: 'M1 Data Feasibility',
        bounded: true,
        sourceCount: 1,
        results: [
          {
            id: 'plus-product',
            supermarket: 'plus',
            kind: 'product',
            success,
          },
        ],
      }),
      'utf8',
    )

    await assert.rejects(
      () => inspectCaptureDirectory(root),
      /boolean success flag/,
    )
  }
})


test('rejects duplicate capture source ids before building inspection evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-duplicate-'))

  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      milestone: 'M1 Data Feasibility',
      bounded: true,
      sourceCount: 2,
      results: [
        {
          id: 'plus-product',
          supermarket: 'plus',
          kind: 'product',
          success: false,
        },
        {
          id: 'plus-product',
          supermarket: 'plus',
          kind: 'product',
          success: false,
        },
      ],
    }),
    'utf8',
  )

  await assert.rejects(
    () => inspectCaptureDirectory(root),
    /Duplicate capture source id/,
  )
})

test('rejects capture retailers and source kinds outside the bounded M1 contract', async () => {
  for (const overrides of [
    { supermarket: 'other-store' },
    { kind: 'search' },
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'supa-m1-inspect-contract-'))

    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        milestone: 'M1 Data Feasibility',
        bounded: true,
        sourceCount: 1,
        results: [
          {
            id: 'bounded-source',
            supermarket: 'plus',
            kind: 'product',
            success: false,
            ...overrides,
          },
        ],
      }),
      'utf8',
    )

    await assert.rejects(
      () => inspectCaptureDirectory(root),
      /Unsupported capture (supermarket|source kind)/,
    )
  }
})
