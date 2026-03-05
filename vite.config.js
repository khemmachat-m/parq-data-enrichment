import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/parq-data-enrichment/' : '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      external: ['papaparse'],
      output: {
        globals: { papaparse: 'Papa' }
      }
    }
  }
})
