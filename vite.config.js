import { defineConfig } from 'vite'

export default defineConfig({
  base: '/parq-data-enrichment/',
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
