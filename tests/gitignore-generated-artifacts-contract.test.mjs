import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8')

function activeIgnoreRules(source) {
  return new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  )
}

test('generated dependency, build and compiler artifacts remain ignored', () => {
  const rules = activeIgnoreRules(gitignore)

  for (const required of [
    'node_modules',
    'dist',
    '*.log',
    '*.tsbuildinfo',
    'vite.config.js',
    'vite.config.d.ts',
  ]) {
    assert.ok(rules.has(required), `missing .gitignore rule: ${required}`)
  }
})
