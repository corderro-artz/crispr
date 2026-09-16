/**
 * Bundle the CLI to a single JS file.
 *
 * playwright-core stays external: it ships platform-specific driver files and
 * spawns its own subprocess, so bundling it produces a file that builds and
 * then cannot launch anything.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outFile = path.join('dist', 'crispr.js');
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: outFile,
  external: ['playwright-core'],
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  minify: false,
});

// A bundled ESM file needs its own package marker when dist/ is copied around.
writeFileSync(path.join('dist', 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

console.log(`built ${outFile}`);
