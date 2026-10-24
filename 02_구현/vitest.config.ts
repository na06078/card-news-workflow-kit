import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  watch: false, cache: false, environment: 'node',
  include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  exclude: ['tests/providers/*실검증*', '**/node_modules/**'],
  maxWorkers: 1, isolate: true
}});
