import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    watch: {
      ignored: ['**/scripts/.tmp/**', '**/docs/**'],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
