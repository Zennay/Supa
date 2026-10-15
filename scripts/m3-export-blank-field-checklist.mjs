import { pathToFileURL } from 'node:url'
import {
  buildObservationSheet,
  M3_EXPECTED_RETAILERS,
} from '../src/domain/m3ObservationSheet.ts'

// Collection aid only. NEVER populate this export with observed prices,
// personal identifiers or data from an unverified retailer feed.
const HEADERS = Object.freeze([
  'retailer_role',
  'retailer',
  'ingredient_id',
  'ingredient_label',
  'search_query',
  'required_amount',
  'required_unit',
  'observed_at',
  'price_context',
  'product_name',
  'pack_amount',
  'pack_unit',
  'pack_count',
  'price_cents',
  'available',
  'source',
  'source_url',
  'note',
  'evidence_status',
])

export function csvCell(value) {
  if (value === null || value === undefined) return '""'
  const raw = String(value)
  // A template may be opened in spreadsheet software. Neutralize formula
  // prefixes and reject control characters rather than exporting active cells.
  if (/[\r\n\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('M3 checklist contains unsafe cell text')
  }
  const safe = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw
  return '"' + safe.replaceAll('"', '""') + '"'
}

function csvRow(values) {
  if (values.length !== HEADERS.length) {
    throw new Error('M3 checklist column count inconsistent')
  }
  return values.map(csvCell).join(',')
}

export function buildBlankM3FieldChecklistCsv() {
  const sheet = buildObservationSheet()
  const requirements = sheet.requirements
  if (
    sheet.sheetType !== 'm3-manual-cart-observation-sheet' ||
    sheet.evidenceStatus !== 'collection-template-not-evidence' ||
    sheet.selectedMealCount !== 4 ||
    !Array.isArray(requirements) ||
    requirements.length !== 11
  ) {
    throw new Error('M3 checklist canonical sheet contract changed')
  }

  // The 22-slot field gate requires ELEVEN distinct, meaningful canonical
  // demands; repeated IDs would make two filled rows look like extra coverage.
  const requirementIds = new Set()
  for (const requirement of requirements) {
    if (
      !requirement || typeof requirement !== 'object' ||
      typeof requirement.id !== 'string' ||
      requirement.id !== requirement.id.trim() ||
      !requirement.id ||
      typeof requirement.label !== 'string' ||
      !requirement.label.trim() ||
      typeof requirement.query !== 'string' ||
      !requirement.query.trim() ||
      !['g', 'kg', 'ml', 'l', 'piece'].includes(requirement.unit) ||
      !Number.isFinite(requirement.amount) ||
      requirement.amount <= 0 ||
      requirementIds.has(requirement.id)
    ) throw new Error('M3 checklist requires eleven distinct valid demands')
    requirementIds.add(requirement.id)
  }

  const rows = [csvRow(HEADERS)]
  for (const role of ['baseline', 'candidate']) {
    const retailer = M3_EXPECTED_RETAILERS[role]
    const observation = sheet[role]
    if (!retailer || !Array.isArray(observation.lines) ||
        observation.lines.length !== requirements.length) {
      throw new Error('M3 checklist retailer contract changed')
    }
    for (let index = 0; index < requirements.length; index++) {
      const requirement = requirements[index]
      const line = observation.lines[index]
      if (
        line.ingredientId !== requirement.id ||
        line.ingredientLabel !== requirement.label ||
        line.requirement.amount !== requirement.amount ||
        line.requirement.unit !== requirement.unit ||
        !Number.isFinite(requirement.amount) ||
        requirement.amount <= 0
      ) throw new Error('M3 checklist demand contract changed')

      // All observational/economic cells MUST start blank; neither a demo
      // fixture nor a structural preflight can provide genuine field evidence.
      rows.push(csvRow([
        role, retailer, requirement.id, requirement.label,
        requirement.query, requirement.amount, requirement.unit,
        '', '', '', '', '', '', '', '', '', '', '',
        'collection-template-not-evidence',
      ]))
    }
  }
  return rows.join('\n') + '\n'
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) {
    throw new Error('usage: node --experimental-strip-types scripts/m3-export-blank-field-checklist.mjs')
  }
  process.stdout.write(buildBlankM3FieldChecklistCsv())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch {
    // Deliberately never echo potentially private data or unknown exceptions.
    console.error('M3 blank checklist export failed; verify canonical sheet contract and arguments')
    process.exitCode = 1
  }
}
