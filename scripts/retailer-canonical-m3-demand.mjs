import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

/**
 * Take one canonical M3 demand directly from the tested M2 week plan.
 * This is an ingredient requirement file, never a price observation or
 * evidence of retailer availability / consent. Both retailers receive this
 * same immutable shopping demand when compared offline.
 */
export function canonicalM3RetailerRequirements() {
  const sheet = buildObservationSheet()
  if (sheet.schemaVersion !== 1 || sheet.plannerFixture !== 'm2-default-week' ||
      sheet.requirements.length !== 11 || sheet.selectedMealCount <= 0) {
    throw new Error('Canonical M3 eleven-line pilot demand has changed')
  }
  const seen = new Set()
  return sheet.requirements.map(({ id, query, amount, unit }) => {
    if (typeof id !== 'string' || !id || seen.has(id) ||
        typeof query !== 'string' || !query.trim() ||
        !Number.isFinite(amount) || amount <= 0 ||
        !['g', 'kg', 'ml', 'l', 'piece'].includes(unit)) {
      throw new Error('Canonical M3 requirement is not safe for catalog comparison')
    }
    seen.add(id)
    return { id, query, amount, unit }
  })
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0 &&
      !(argv.length === 2 && argv[0] === '--out' &&
        typeof argv[1] === 'string' && argv[1].trim() &&
        // A bare CLI option is never an explicit destination path. Keep
        // absolute paths valid even when their basename resembles a flag.
        !argv[1].startsWith('-'))) {
    throw new Error('Usage: node --experimental-strip-types scripts/retailer-canonical-m3-demand.mjs [--out private-requirements.json]')
  }
  const payload = JSON.stringify(canonicalM3RetailerRequirements(), null, 2) + '\n'
  if (argv.length === 0) {
    process.stdout.write(payload)
    return
  }
  await writeFile(argv[1], payload, { flag: 'wx', mode: 0o600 })
  console.log('Private M3 eleven-line requirements created (NO retailer evidence)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
