import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    // Token-free by default: every test run uses mock AI + in-memory DB.
    // Override per-process with MOCK_AI=false to hit the real Anthropic API.
    env: {
      MOCK_AI: 'true',
      DB_MODE: 'mock',
    },
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'converter'],
  },
})
