import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function checkBootstrap(html) {
  const issues = []
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  for (const [, attributes, body] of scripts) {
    const src = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]
    if (!src) issues.push('inline or missing-src script')
    else if (src !== '/src/main.tsx') issues.push('unexpected script source: ' + src)
    if (!/\btype\s*=\s*(["'])module\1/i.test(attributes)) {
      issues.push('script must be a module')
    }
    if (body.trim()) issues.push('script body must be empty')
  }
  if (scripts.length !== 1) issues.push('expected exactly one bootstrap script')

  const metaRefresh = /<meta\b[^>]*\bhttp-equiv\s*=\s*(["'])?refresh\1?[^>]*>/i
  if (metaRefresh.test(html)) issues.push('meta refresh is prohibited')
  if (!/<html\b[^>]*\blang\s*=\s*["']nl["']/i.test(html)) {
    issues.push('Dutch document language is required')
  }
  if (!/<div\s+id\s*=\s*["']root["']\s*>\s*<\/div>/i.test(html)) {
    issues.push('React root missing')
  }
  return issues
}

test('index.html retains one local module bootstrap and no automatic redirect', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.deepEqual(checkBootstrap(html), [])
})

test('bootstrap contract catches injected scripts and meta redirect', () => {
  const valid = '<html lang="nl"><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>'
  assert.deepEqual(checkBootstrap(valid), [])
  for (const injection of [
    '<script src="https://third-party.example/x.js" type="module"></script>',
    '<script>alert(1)</script>',
    '<script type="module" src="/src/main.tsx">alert(1)</script>',
    '<meta http-equiv="refresh" content="0;url=https://example.test">',
  ]) {
    const candidate = injection.includes('main.tsx')
      ? valid.replace('<script type="module" src="/src/main.tsx"></script>', injection)
      : valid.replace('</html>', injection + '</html>')
    assert.notDeepEqual(checkBootstrap(candidate), [], injection)
  }
})
