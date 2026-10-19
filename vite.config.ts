import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4174' } },
  build: {
    sourcemap: false,
    // Keep the reviewed local source-matching and two-store screens deployable
    // alongside the main planner rather than only reachable in development.
    rollupOptions: { input: ['index.html', 'private-basket-mapping.html', 'private-basket-compare.html'] },
  },
  preview: {
    strictPort: true,
  },
})
