/**
 * Independent offline-only quality attestation: compare each *historical*
 * PLUS/DekaMartk observation in a private SQLite export against the six
 * separately reviewed repository fixtures. Do not publish price-level rows.
 */
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { loadReviewedRepositoryFixtures } from './retailer-reviewed-ingest-engine.mjs'

const READ_SQLITE = `
import json, os, sqlite3, stat, sys, unicodedata
from urllib.parse import quote
path = os.path.abspath(sys.argv[1])
expected_count = int(sys.argv[2])
current = path
while True:
    mode = os.lstat(current).st_mode
    if stat.S_ISLNK(mode):
        raise ValueError("unsafe private source")
    if current == path and (not stat.S_ISREG(mode) or mode & 0o077):
        raise ValueError("unsafe private source")
    parent = os.path.dirname(current)
    if parent == current:
        break
    current = parent
if os.stat(path).st_size > 16 * 1024 * 1024:
    raise ValueError("oversized source")
with sqlite3.connect("file:" + quote(path) + "?mode=ro&immutable=1", uri=True, timeout=2) as db:
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA trusted_schema=OFF")
    # Exact schema-v1 metadata: never silently accept an extra shadow grant
    # beside the known private-only source licence markers.
    meta_rows = list(db.execute("SELECT key,value FROM metadata"))
    metadata = dict(meta_rows)
    if len(meta_rows) != 5 or set(metadata) != {
        "schema_version", "origin", "production_enabled",
        "public_savings_claim_eligible", "requires_explicit_retailer_license"
    }:
        raise ValueError("unexpected private source metadata")
    if (metadata.get("schema_version") != "1" or
        metadata.get("origin") != "offline-reviewed-snapshots-only" or
        metadata.get("production_enabled") != "false" or
        metadata.get("public_savings_claim_eligible") != "false" or
        metadata.get("requires_explicit_retailer_license") != "true"):
        raise ValueError("invalid private metadata")
    retailers = set(db.execute("SELECT retailer_id,canonical_host,permission_status,production_enabled FROM retailer_sources"))
    if retailers != {("plus","www.plus.nl","permission_required",0),("dekamarkt","www.dekamarkt.nl","unresolved",0)}:
        raise ValueError("unauthorized retailer source")
    n = db.execute("SELECT COUNT(*) FROM price_observations").fetchone()[0]
    snapshots = db.execute("SELECT COUNT(*) FROM source_snapshots").fetchone()[0]
    if n != expected_count or snapshots != 6:
        raise ValueError("incomplete source facts")
    rows = list(db.execute("""
      SELECT o.retailer_id,s.kind,s.source_url,s.captured_at,
             s.content_sha256,o.source_product_id,p.display_name,
             o.price_cents,o.currency,o.pack_text,o.pack_amount,o.pack_unit,
             o.availability,o.offer_label,o.offer_price_cents,
             o.original_price_cents,o.offer_valid_from,o.offer_valid_to
      FROM price_observations o
      JOIN products p ON p.retailer_id=o.retailer_id AND p.source_product_id=o.source_product_id
      JOIN source_snapshots s ON s.id=o.snapshot_id AND s.retailer_id=o.retailer_id
    """))
    if len(rows) != n:
        raise ValueError("broken source-to-product ownership")
    # A correct price count is not proof of a correct catalog: an additional
    # unobserved retail product can silently survive the join above, and a
    # corrupt derived search_name would never appear in price records.
    # Verify the ENTIRE catalog has precisely the identities supported by
    # physical observations, and index text exactly matches the importer.
    catalog_rows = list(db.execute(
        "SELECT retailer_id,source_product_id,display_name,search_name FROM products"))
    observed_products = {(row[0], row[5]): row[6] for row in rows}
    if len(catalog_rows) != len(observed_products):
        raise ValueError("unobserved or absent retailer products")
    for retailer, product_id, name, search_name in catalog_rows:
        if (observed_products.get((retailer, product_id)) != name or
            not isinstance(name, str) or
            search_name != " ".join(unicodedata.normalize("NFKC", name).casefold().split())):
            raise ValueError("inconsistent retailer product identity or search index")
    print(json.dumps(rows,ensure_ascii=False,separators=(",",":")))
`

function expectedRow(observation) {
  const p = observation.provenance
  const o = observation.offer
  return [
    observation.supermarket, p.kind, p.url, p.capturedAt, p.sha256,
    observation.sourceProductId, observation.name, observation.currentPriceCents,
    observation.currency, observation.pack.rawText, observation.pack.amount,
    observation.pack.unit, observation.availability, o?.label ?? null,
    o?.offerPriceCents ?? null, o?.originalPriceCents ?? null,
    o?.validFrom ?? null, o?.validTo ?? null,
  ]
}

function refuse() {
  throw new Error('Private historical retailer source/SQLite parity refused')
}

export async function checkReviewedSqliteExactParity(database) {
  if (typeof database !== 'string' || !database.trim() || database.startsWith('-')) refuse()
  const batch = await loadReviewedRepositoryFixtures()
  if (batch.summary?.sources !== 6 || batch.summary?.acceptedSources !== 6 ||
      batch.summary?.rejectedSources !== 0 || batch.summary?.productionEnabled !== false ||
      batch.summary?.permissionVerified !== false ||
      batch.summary?.publicSavingsClaimEligible !== false) refuse()
  const expected = batch.results.flatMap(result => {
    if (result.accepted !== true || !Array.isArray(result.observations)) refuse()
    return result.observations.map(expectedRow)
  })
  if (expected.length !== batch.summary.observations) refuse()
  const result = spawnSync('python3', ['-c', READ_SQLITE, database, String(expected.length)], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 512 * 1024,
  })
  if (result.status !== 0) refuse()
  let actual
  try { actual = JSON.parse(result.stdout) } catch { refuse() }
  if (!Array.isArray(actual) || actual.length !== expected.length) refuse()
  // Preserve multiplicity (two identical observations count as two physical rows).
  // Canonical tuple order is used only inside this process and never emitted.
  const canonical = rows => rows.map(row => JSON.stringify(row)).sort()
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) refuse()
  return {
    mode: 'private-historical-retailer-source-parity-qa',
    matchesOriginalFixtures: true,
    capturedSources: 6,
    retailerCount: 2,
    verifiedObservations: expected.length,
    historicalOnly: true,
    productionEnabled: false,
    publicSavingsClaimEligible: false,
  }
}

export async function main(args = process.argv.slice(2), emit = text => process.stdout.write(text)) {
  if (args.length !== 2 || args[0] !== '--database') refuse()
  const summary = await checkReviewedSqliteExactParity(args[1])
  emit(JSON.stringify(summary) + '\n')
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Private historical retailer source/SQLite parity refused')
    process.exitCode = 2
  })
}
