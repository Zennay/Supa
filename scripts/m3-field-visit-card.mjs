import { pathToFileURL } from 'node:url'

import { renderM3FieldVisitCard } from '../src/domain/m3FieldVisitCard.ts'

function selectionFromArgs(args) {
  if (args.length === 0) return 'both'
  if (args.length === 2 && args[0] === '--store') {
    if (args[1] === 'both') return 'both'
    if (args[1] === 'plus') return 'baseline'
    if (args[1] === 'dekamarkt') return 'candidate'
  }
  throw new Error('gebruik: npm run m3:field-visit-card -- [--store both|plus|dekamarkt]')
}

export function main(args = process.argv.slice(2)) {
  process.stdout.write(renderM3FieldVisitCard(selectionFromArgs(args)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'onbekende fout')
    process.exitCode = 1
  }
}
