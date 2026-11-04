import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * Writes dist/sw.js from src/sw-template.js after the build. The version is a
 * hash of every published file, so each deploy with changes is a new service
 * worker and the app can offer "Dostępna nowa wersja".
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'collage-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir)
        .filter((f) => !f.endsWith('sw.js'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(relative(outDir, f)).update(readFileSync(f));
      const version = hash.digest('hex').slice(0, 12);
      const assets = ['./', ...files.map((f) => './' + relative(outDir, f).split('\\').join('/'))];
      const sw = readFileSync('src/sw-template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(assets));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

// `npm run build` produces a self-contained dist/index.html (plus manifest,
// icons and the service worker for installing the app on a phone).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), serviceWorker()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
