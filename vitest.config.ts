import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@financial-pipeline/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@financial-pipeline/adapter-utils': resolve(__dirname, 'packages/adapter-utils/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'services/*/src/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
  },
});
