import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const productionRoots = ['src']
const productionFiles = ['index.html', 'vite.config.ts']
const markers = /^(?:<<<<<<<(?: .*)?|=======$|>>>>>>> (?:.*))$/

function conflictMarkers(source) {
  return source.split(/\r?\n/).flatMap((line, index) =>
    markers.test(line) ? [{ line: index + 1, marker: line }] : [],
  )
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    if (entry.isFile() && /\.(?:js|jsx|ts|tsx|css|json)$/.test(entry.name)) {
      return [absolute]
    }
    return []
  })
}

test('merge-marker parser rejects unresolved conflict delimiters', () => {
  assert.deepEqual(
    conflictMarkers('safe\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n'),
    [
      { line: 2, marker: '<<<<<<< HEAD' },
      { line: 4, marker: '=======' },
      { line: 6, marker: '>>>>>>> feature' },
    ],
  )
  assert.deepEqual(conflictMarkers('const value = "======="\n// >>>>>>> illustrative'), [])
})

test('production source contains no unresolved git conflict markers', () => {
  const paths = [
    ...productionRoots.flatMap((dir) => walk(resolve(root, dir))),
    ...productionFiles.map((file) => resolve(root, file)),
  ]
  const findings = paths.flatMap((path) =>
    conflictMarkers(readFileSync(path, 'utf8')).map(({ line, marker }) =>
      `${relative(root, path)}:${line}: ${marker}`,
    ),
  )
  assert.deepEqual(findings, [], `Unresolved git conflict markers:\n${findings.join('\n')}`)
})
