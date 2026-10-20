import { build } from 'esbuild'

/**
 * The real production server must not rely on Node's optional TypeScript
 * stripping: server/app.mjs imports the shared recipe parser as .ts.
 * Compile that parser into the deployable Node entrypoint at build time.
 * No retailer scraping or external network access is involved.
 */
await build({
  entryPoints: ['server/app.mjs'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  logLevel: 'warning',
})
