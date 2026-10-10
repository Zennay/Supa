import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('desktop shell clips rounded corners without becoming a sticky scroll boundary', () => {
  assert.match(
    styles,
    /\.topbar\s*{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/,
  )

  const desktopShell =
    styles.match(
      /@media \(min-width:\s*700px\)\s*{[\s\S]*?\.app-shell\s*{([\s\S]*?)}[\s\S]*?}/,
    )?.[1] ?? ''

  assert.match(desktopShell, /overflow:\s*clip;/)
  assert.doesNotMatch(desktopShell, /overflow(?:-x|-y)?:\s*(?:auto|scroll|hidden);/)
})
