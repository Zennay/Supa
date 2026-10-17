import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Keep the browser's Host header: the API only accepts writes whose Origin
  // matches it (the string shorthand would rewrite Host to 127.0.0.1:4174).
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4174', changeOrigin: false } } },
  build: {
    sourcemap: false,
  },
  preview: {
    strictPort: true,
  },
})
