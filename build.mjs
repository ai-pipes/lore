import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/cli.js',
  format: 'cjs',
  external: ['better-sqlite3'],
  banner: {
    js: '#!/usr/bin/env node',
  },
  sourcemap: false,
  minify: false,
});

// Third-party browser assets for the chat UI (served from /assets/vendor/).
// Keep in sync with VENDOR_FILES in src/platform/http/ui-assets.ts.
const vendor = {
  'marked.umd.js': 'marked/lib/marked.umd.js',
  'purify.min.js': 'dompurify/dist/purify.min.js',
  'highlight.min.js': '@highlightjs/cdn-assets/highlight.min.js',
  'github-dark.min.css': '@highlightjs/cdn-assets/styles/github-dark.min.css',
  'mermaid.min.js': 'mermaid/dist/mermaid.min.js',
};
mkdirSync('dist/vendor', { recursive: true });
for (const [name, rel] of Object.entries(vendor)) copyFileSync(`node_modules/${rel}`, `dist/vendor/${name}`);

console.log('Build complete: dist/cli.js, dist/vendor/');
