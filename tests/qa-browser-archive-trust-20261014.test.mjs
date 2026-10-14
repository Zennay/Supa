import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Only local fictional ZIP fixtures; no GitHub auth, live users, prices or VPS.
const auditor = new URL('../scripts/qa-audit-browser-archive-20261014.mjs', import.meta.url).pathname
const head = 'c912818c02a60bbdf44a0b0951e2f166fd96784b'
const runId = '38490414616'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64',
)

function sample() {
  return {
    schemaVersion: 1, category: 'synthetic-M2-M3-product-flow',
    checkoutSha: 'b'.repeat(40), pullRequestHeadSha: head,
    githubRunId: runId, githubRunAttempt: '1',
    checks: ['initial-planner-render', 'synthetic-empty-check'],
    screenshots: ['fictional-browser.png'],
    screenshotIntegrity: [{
      filename: 'fictional-browser.png',
      bytes: png.length, width: 1, height: 1,
      sha256: createHash('sha256').update(png).digest('hex'),
    }],
    retailerDataObserved: false, realSavingsClaimEligible: false,
  }
}

function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-browser-artifact-audit-'))
  const archive = join(dir, 'evidence.zip')
  const manifest = options.meta ?? sample()
  const pngFile = join(dir, 'image.bin')
  const jsonFile = join(dir, 'meta.json')
  const savedImage = options.image ?? png
  writeFileSync(pngFile, savedImage)
  writeFileSync(jsonFile, JSON.stringify(manifest))
  const members = options.members ?? [
    ['result.json', jsonFile],
    ['fictional-browser.png', pngFile],
  ]
  const python = [
    'import sys, json, zipfile, warnings',
    'warnings.simplefilter("ignore", UserWarning)',
    'z=zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED)',
    'for name,path in json.loads(sys.argv[2]): z.write(path,arcname=name)',
    'z.close()',
  ].join('\n')
  execFileSync('python3', ['-c', python, archive, JSON.stringify(members)])
  const result = spawnSync(process.execPath,
    [auditor, archive, '--head', head, '--run', runId],
    { encoding: 'utf8', timeout: 12000, maxBuffer: 1024 * 1024 })
  return { result, dir, pngFile, jsonFile }
}

function withFixture(options, verify) {
  const { result, dir } = fixture(options)
  try {
    assert.equal(result.error, undefined, 'a timeout cannot count as safe rejection')
    assert.equal(result.signal, null)
    verify(result)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('positive: SHA-pinned fictional PNG, run, exact source HEAD and flags are verified', () => {
  withFixture({}, r => {
    assert.equal(r.status, 0, r.stderr)
    const data = JSON.parse(r.stdout)
    assert.equal(data.verified, true)
    assert.equal(data.sourceHead, head)
    assert.equal(data.workflowRun, runId)
    assert.equal(data.pngs, 1)
    assert.equal(data.checks, 2)
    assert.equal(data.humanFieldEvidence, false)
    assert.equal(data.releaseEligible, false)
  })
})

test('reject edited PNG even if a valid PNG header and dimensions remain', () => {
  const changed = Buffer.from(png)
  changed[changed.length - 4] ^= 1
  withFixture({ image: changed }, r => {
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
  })
})

test('reject forged SHA value in the archived metadata', () => {
  const meta = sample()
  meta.screenshotIntegrity[0].sha256 = 'a'.repeat(64)
  withFixture({ meta }, r => {
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
  })
})

test('reject wrong head SHA even with valid original screenshots', () => {
  const meta = sample()
  meta.pullRequestHeadSha = 'a'.repeat(40)
  withFixture({ meta }, r => {
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
  })
})

test('reject false claims of live retailer data or release-ready savings', () => {
  for (const field of ['retailerDataObserved', 'realSavingsClaimEligible']) {
    const meta = sample()
    meta[field] = true
    withFixture({ meta }, r => {
      assert.notEqual(r.status, 0, field)
      assert.equal(r.stdout, '')
    })
  }
})

test('reject a missing image in the ZIP rather than trusting the JSON manifest alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supa-auditor-no-image-'))
  try {
    const manifest = join(dir, 'result.json')
    writeFileSync(manifest, JSON.stringify(sample()))
    const r = fixture({ members: [['result.json', manifest]] })
    try {
      assert.notEqual(r.result.status, 0)
      assert.equal(r.result.stdout, '')
    } finally { rmSync(r.dir, { recursive: true, force: true }) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('reject duplicate ZIP member, unknown member and traversal member', () => {
  for (const member of ['fictional-browser.png', 'outside.png', '../escape.png']) {
    const dir = mkdtempSync(join(tmpdir(), 'supa-auditor-extra-'))
    try {
      const metaFile = join(dir, 'manifest.json')
      const imageFile = join(dir, 'image.png')
      writeFileSync(metaFile, JSON.stringify(sample()))
      writeFileSync(imageFile, png)
      const r = fixture({
        members: [
          ['result.json', metaFile],
          ['fictional-browser.png', imageFile],
          [member, imageFile],
        ],
      })
      try {
        assert.notEqual(r.result.status, 0, member)
        assert.equal(r.result.stdout, '', member)
      } finally { rmSync(r.dir, { recursive: true, force: true }) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})

test('reject changed PNG dimensions or dishonest byte counts', () => {
  for (const change of [{ width: 2 }, { bytes: png.length + 3 }]) {
    const meta = sample()
    Object.assign(meta.screenshotIntegrity[0], change)
    withFixture({ meta }, r => {
      assert.notEqual(r.status, 0)
      assert.equal(r.stdout, '')
    })
  }
})
