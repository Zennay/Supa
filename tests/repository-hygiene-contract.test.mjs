import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const gitignoreUrl = new URL('../.gitignore', import.meta.url)

const requiredIgnoreRules = [
  'node_modules',
  'dist',
  '.DS_Store',
  '.env',
  '.env.*',
  '!.env.example',
  '.vscode',
  '.idea',
  '*.log',
  '*.tsbuildinfo',
  'vite.config.js',
  'vite.config.d.ts',
  'artifacts/',
]

function forbiddenTrackedPath(path) {
  const segments = path.split('/')
  const filename = segments.at(-1) ?? ''

  if (segments.some((segment) => segment === 'node_modules' || segment === 'dist' || segment === 'artifacts')) {
    return true
  }

  if (segments.some((segment) => segment === '.vscode' || segment === '.idea' || segment === '.DS_Store')) {
    return true
  }

  if (segments.some((segment) => segment === '.env' || (segment.startsWith('.env.') && segment !== '.env.example'))) {
    return true
  }

  return (
    filename.endsWith('.log') ||
    filename.endsWith('.tsbuildinfo') ||
    filename === 'vite.config.js' ||
    filename === 'vite.config.d.ts'
  )
}

test('gitignore keeps the repository local-artifact boundary explicit', async () => {
  const gitignore = await readFile(gitignoreUrl, 'utf8')
  const rules = new Set(
    gitignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  )

  for (const rule of requiredIgnoreRules) {
    assert.ok(rules.has(rule), `.gitignore must retain ${rule}`)
  }
})

test('tracked files do not contain ignored local or secret-adjacent artifacts', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })

  const forbidden = stdout
    .split('\0')
    .filter(Boolean)
    .filter(forbiddenTrackedPath)
    .sort()

  assert.deepEqual(
    forbidden,
    [],
    `tracked local/secret-adjacent artifacts must be removed: ${forbidden.join(', ')}`,
  )
})
