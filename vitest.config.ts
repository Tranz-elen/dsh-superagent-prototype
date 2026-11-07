import { defineConfig } from 'vitest/config'
// Share one React instance across DSH client packages and tests.
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Count every source file, not only the ones a test imports, and include the
      // client: its tests run in jsdom in the same suite. See README.md, Development.
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Generate the report for a failed test run too, so a person can see how far a change moved coverage.
      reportOnFailure: true,
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
})
