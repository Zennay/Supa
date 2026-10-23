import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('Figma images accept shipped assets and reject arbitrary network and data URLs', async () => {
  const vite = await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'})
  try {
    const { FigmaImage } = await vite.ssrLoadModule('/src/components/FigmaImage.tsx')
    const { figmaAssets } = await vite.ssrLoadModule('/src/features/home/figmaAssets.ts')
    for (const asset of ['https://example.com/tracker.png','//example.com/tracker.svg','data:image/svg+xml,test','/not-bundled.png','']) {
      assert.equal(renderToStaticMarkup(createElement(FigmaImage,{asset,alt:''})), '')
    }
    for (const asset of Object.values(figmaAssets)) {
      const html = renderToStaticMarkup(createElement(FigmaImage,{asset,alt:'reviewed'}))
      assert.match(html, /<img/)
      assert.match(html, /alt="reviewed"/)
      assert.doesNotMatch(html, /figma\.com/)
    }
  } finally { await vite.close() }
})
