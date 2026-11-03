import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces a single self-contained dist/index.html that can be
// opened straight from disk or hosted anywhere (GitHub Pages, etc.).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
