/**
 * Build the release shapes.
 *
 * `playwright-core` is never bundled: it lazily requires `chromium-bidi` by
 * path and resolves its own driver relative to its real location, so every
 * shape ships it as files and `src/playwright.ts` finds them.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const BUILD = path.join(ROOT, 'build');
const RELEASE = path.join(BUILD, 'release');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TAG = `crispr-${VERSION}-win-x64`;

const step = (msg) => process.stdout.write(`\n== ${msg}\n`);
// No `shell: true`: it re-splits arguments on spaces, which turns
// "C:\Program Files\nodejs\node.exe" into a command called "C:\Program".
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(RELEASE, { recursive: true });

// ---------------------------------------------------------------- CJS bundle
step('bundling (CommonJS, for the single-file executable)');
const seaDir = path.join(BUILD, 'sea');
fs.mkdirSync(seaDir, { recursive: true });
const cjsEntry = path.join(seaDir, 'crispr.cjs');

run(process.execPath, [
  path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  'src/main.ts',
  '--bundle',
  '--platform=node',
  '--target=node22',
  '--format=cjs',
  `--outfile=${cjsEntry}`,
  '--external:playwright-core',
  '--legal-comments=none',
]);

// ------------------------------------------------------------------- SEA exe
step('building crispr.exe (Node single executable application)');
const seaConfig = path.join(seaDir, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: cjsEntry,
      output: path.join(seaDir, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
      // Not useSnapshot: the entry reads process.argv and the filesystem at
      // startup, which a snapshot would freeze at build time.
      useCodeCache: false,
    },
    null,
    2,
  ),
);

run(process.execPath, ['--experimental-sea-config', seaConfig]);

const exe = path.join(seaDir, 'crispr.exe');
fs.copyFileSync(process.execPath, exe);

// Windows binaries are signed; the signature must go before postject rewrites
// the file, or the result is a binary Windows refuses to start.
try {
  run('signtool', ['remove', '/s', exe], { stdio: 'ignore' });
} catch {
  process.stdout.write('   (signtool unavailable; continuing unsigned)\n');
}

run(process.execPath, [
  path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'),
  exe,
  'NODE_SEA_BLOB',
  path.join(seaDir, 'sea-prep.blob'),
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]);

// -------------------------------------------------------------- shared parts
/** Copy playwright-core, without the browser binaries it may have downloaded. */
function copyPlaywright(destModules) {
  const src = path.dirname(require.resolve('playwright-core/package.json'));
  const dest = path.join(destModules, 'playwright-core');
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => !/[\\/]\.local-browsers[\\/]/.test(from),
  });
}

/** The pinned headless shell, if one has been installed locally. */
function findLocalShell() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dir = fs.readdirSync(base).find((d) => d.startsWith('chromium_headless_shell'));
  return dir ? path.join(base, dir) : null;
}

function zip(dir, name) {
  const target = path.join(RELEASE, `${name}.zip`);
  run('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${dir}\\*' -DestinationPath '${target}' -Force`,
  ]);
  return target;
}

// ------------------------------------------------------------------- shapes
const shapes = [];

step('shape 1/3: portable');
{
  const dir = path.join(BUILD, 'portable');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.copyFileSync(exe, path.join(dir, 'crispr.exe'));
  copyPlaywright(path.join(dir, 'node_modules'));
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(dir, 'README.md'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));

  const shell = findLocalShell();
  if (shell) fs.cpSync(shell, path.join(dir, 'browsers'), { recursive: true });
  else process.stdout.write('   WARNING: no local headless shell found; portable will download on first run\n');

  shapes.push({ name: 'Portable', file: zip(dir, `${TAG}-portable`), needsNode: 'No' });
}

step('shape 2/3: single file, thin');
{
  const dir = path.join(BUILD, 'single-file-thin');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.copyFileSync(exe, path.join(dir, 'crispr.exe'));
  copyPlaywright(path.join(dir, 'node_modules'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
  shapes.push({ name: 'Single file, thin', file: zip(dir, `${TAG}-single-file-thin`), needsNode: 'No' });
}

step('shape 3/3: node-dependent');
{
  const dir = path.join(BUILD, 'node-dependent');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  run(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')]);
  fs.cpSync(path.join(ROOT, 'dist'), path.join(dir, 'dist'), { recursive: true });
  copyPlaywright(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'crispr.cmd'), '@echo off\r\nnode "%~dp0dist\\crispr.js" %*\r\n');
  fs.writeFileSync(path.join(dir, 'crispr'), '#!/bin/sh\nexec node "$(dirname "$0")/dist/crispr.js" "$@"\n');
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
  shapes.push({ name: 'Node-dependent', file: zip(dir, `${TAG}-node-dependent`), needsNode: 'Yes' });
}

// ------------------------------------------------------------------ manifest
step('release');
const mb = (f) => `${(fs.statSync(f).size / 1024 / 1024).toFixed(1)} MB`;
const rows = shapes.map((s) => `| **${s.name}** | ${mb(s.file)} | ${s.needsNode} | ${path.basename(s.file)} |`);
const manifest = [
  `| Shape | Size | Node needed | File |`,
  `| --- | --- | --- | --- |`,
  ...rows,
].join('\n');

fs.writeFileSync(path.join(RELEASE, 'MANIFEST.md'), `# crispr ${VERSION}\n\n${manifest}\n`);
process.stdout.write(`\n${manifest}\n\nwrote ${RELEASE}\n`);
