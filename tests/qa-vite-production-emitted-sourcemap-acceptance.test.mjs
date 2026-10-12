import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build, resolveConfig } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

function emittedFiles(result) {
  const outputs = Array.isArray(result) ? result : [result]
  assert.ok(outputs.length > 0, 'production build must return at least one output')
  return outputs.flatMap(output => {
    assert.ok(Array.isArray(output.output), 'expected Rollup output in memory')
    return output.output
  })
}

// Output-level acceptance, deliberately independent from the Vite config
// source assertion in tests/vite-build-sourcemap-contract.test.mjs.
function sourceMapLeaks(files) {
  const found = []
  for (const file of files) {
    const filename = file.fileName
    if (/\.map(?:$|[?#])/i.test(filename)) {
      found.push(`map artifact: ${filename}`)
    }

    const body = file.type === 'chunk'
      ? file.code
      : typeof file.source === 'string'
        ? file.source
        : file.source instanceof Uint8Array
          ? new TextDecoder().decode(file.source)
          : ''

    // Both external and data-URI maps require a sourceMappingURL directive.
    if (/(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/i.test(body)) {
      found.push(`sourceMappingURL directive: ${filename}`)
    }
  }
  return found
}

test('QA #997: output-level scanner distinguishes real sourcemap artifacts and inline directives', () => {
  const mock = (fileName, source) => ({ type: 'asset', fileName, source })
  assert.deepEqual(sourceMapLeaks([
    mock('assets/app.js', 'const value = 1;'),
    mock('assets/site.css', 'body { display: block }'),
  ]), [])
  assert.deepEqual(sourceMapLeaks([
    mock('assets/app.js.map', '{}'),
  ]), ['map artifact: assets/app.js.map'])
  assert.deepEqual(sourceMapLeaks([
    mock('assets/app.js', 'const x=1;\n//# sourceMappingURL=app.js.map'),
  ]), ['sourceMappingURL directive: assets/app.js'])
  assert.deepEqual(sourceMapLeaks([
    mock('assets/site.css', 'body{}/*# sourceMappingURL=data:application/json;base64,e30= */'),
  ]), ['sourceMappingURL directive: assets/site.css'])
})

test('QA #997: real Vite production output omits JS/CSS maps and sourceMappingURL', async () => {
  const configuration = await resolveConfig({ configFile, root }, 'build')
  assert.equal(configuration.build.sourcemap, false,
    'production policy must explicitly resolve to sourcemap:false')

  // Avoid touching dist/ or any other CI job: build stays in memory. Import
  // the actual reviewed Vite config instead of substituting a test config.
  const result = await build({
    root,
    configFile,
    logLevel: 'silent',
    build: { write: false },
  })
  const files = emittedFiles(result)
  const fileNames = files.map(file => file.fileName)
  assert.ok(fileNames.some(name => name.endsWith('.js')),
    'real client bundle must contain JavaScript')
  assert.ok(fileNames.some(name => name.endsWith('.css')),
    'real client bundle must contain CSS')
  assert.deepEqual(sourceMapLeaks(files), [],
    'no emitted .map file or embedded sourceMappingURL may ship')
})
