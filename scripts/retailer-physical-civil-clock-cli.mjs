import { pathToFileURL } from 'node:url'
import {
  physicalCaptureNanoseconds,
  samePhysicalCaptureInstant,
} from './retailer-physical-civil-clock.mjs'

// This manual offline inspector checks *notation only*. It never authenticates
// a retailer, grants rights, or reads a private source file.
function inspect(args) {
  if (args.length === 2 && args[0] === '--check') {
    const validCivilNotation = physicalCaptureNanoseconds(args[1]) !== null
    return { validCivilNotation, reviewed: false, sourceRightsVerified: false }
  }
  if (args.length === 3 && args[0] === '--same') {
    const left = physicalCaptureNanoseconds(args[1])
    const right = physicalCaptureNanoseconds(args[2])
    return {
      validCivilNotation: left !== null && right !== null,
      samePhysicalInstant: samePhysicalCaptureInstant(args[1], args[2]),
      reviewed: false,
      sourceRightsVerified: false,
    }
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspect(process.argv.slice(2))
  if (!result) {
    process.stderr.write('usage: node scripts/retailer-physical-civil-clock-cli.mjs --check <ISO> | --same <ISO> <ISO>\n')
    process.exitCode = 2
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (!result.validCivilNotation) process.exitCode = 1
  }
}
