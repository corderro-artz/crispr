import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { launch, PagePool, resolveBrowser } from '../../src/browser.ts';
import { FontRegistry } from '../../src/fonts/registry.ts';
import { renderOne } from '../../src/render.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures', 'brand');
const FONTS = path.join(here, '..', 'fixtures', 'fonts');

let browser: Browser;
let pool: PagePool;
let outDir: string;

before(async () => {
  browser = await launch(resolveBrowser());
  pool = await PagePool.create(browser, 2);
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-render-'));
});

after(async () => {
  await pool?.close();
  await browser?.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

/** PNG dimensions straight from the IHDR chunk, so no image library is needed. */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, 'not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function job(name: string, out: string) {
  return { input: path.join(FIXTURES, name), output: path.join(outDir, out) };
}

async function emptyRegistry(): Promise<FontRegistry> {
  return FontRegistry.create({
    noFetch: true,
    env: { CRISPR_CACHE_DIR: path.join(outDir, 'cache-empty') },
  });
}

test('renders at the intrinsic size when no sizing flags are given', async () => {
  const fonts = await emptyRegistry();
  const result = await pool.run((lease) => renderOne(lease, job('akira-icon.svg', 'a.png'), { fonts }));

  assert.deepEqual({ width: result.width, height: result.height }, { width: 256, height: 256 });
  assert.deepEqual(pngSize(result.output), { width: 256, height: 256 });
});

test('scale multiplies the intrinsic size', async () => {
  const fonts = await emptyRegistry();
  const result = await pool.run((lease) =>
    renderOne(lease, job('akira-icon.svg', 'a2x.png'), { fonts, scale: 2 }),
  );
  assert.deepEqual(pngSize(result.output), { width: 512, height: 512 });
});

test('a pinned width derives the height from the aspect ratio', async () => {
  const fonts = await emptyRegistry();
  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-banner.svg', 'banner.png'), { fonts, width: 1500 }),
  );
  // 1000x200 source, so 1500 wide must be 300 tall.
  assert.deepEqual(pngSize(result.output), { width: 1500, height: 300 });
});

test('a non-integer scale still yields exact integer dimensions', async () => {
  const fonts = await emptyRegistry();
  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-banner.svg', 'odd.png'), { fonts, scale: 1.37 }),
  );
  assert.deepEqual(pngSize(result.output), { width: 1370, height: 274 });
});

test('an SVG with no text reports no substitutions', async () => {
  const fonts = await emptyRegistry();
  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-favicon.svg', 'fav.png'), { fonts }),
  );
  assert.deepEqual(result.substitutions, []);
  assert.deepEqual(result.fetched, []);
});

test('a missing font is detected as a substitution when fetching is disabled', async () => {
  const fonts = await emptyRegistry();
  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-logo.svg', 'logo-sub.png'), { fonts }),
  );

  assert.ok(result.substitutions.length > 0, 'expected Noto to be reported as substituted');
  const first = result.substitutions[0]!;
  assert.ok(first.requested.some((f) => f.startsWith('Noto')));
  assert.ok(!first.actual.some((f) => f.startsWith('Noto')));
});

test('supplying the requested family removes the substitution', async () => {
  // Register Syncopate under the names the SVG asks for. The point is that a
  // supplied family satisfies the stack, not which typeface it happens to be.
  const file = path.join(FONTS, 'Syncopate-Regular.ttf');
  const fonts = await FontRegistry.create({
    specs: [`Noto Sans JP=${file}`, `Noto Sans=${file}`],
    noFetch: true,
    env: { CRISPR_CACHE_DIR: path.join(outDir, 'cache-supplied') },
  });

  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-logo.svg', 'logo-ok.png'), { fonts }),
  );
  assert.deepEqual(result.substitutions, [], 'a supplied family must satisfy the stack');
});

test('transparent by default, opaque with a background', async () => {
  const fonts = await emptyRegistry();
  const bare = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-favicon.svg', 'bg-none.png'), { fonts }),
  );
  const painted = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-favicon.svg', 'bg-red.png'), { fonts, background: '#ff0000' }),
  );

  // Both render; the painted one must differ in bytes from the transparent one.
  assert.notEqual(
    fs.readFileSync(bare.output).toString('base64'),
    fs.readFileSync(painted.output).toString('base64'),
  );
});

test('dimensions beyond the Chromium limit are refused', async () => {
  const fonts = await emptyRegistry();
  await assert.rejects(
    () => pool.run((lease) => renderOne(lease, job('akira-icon.svg', 'huge.png'), { fonts, scale: 100 })),
    /16384/,
  );
});

test('the pool serializes work beyond its capacity without deadlocking', async () => {
  const fonts = await emptyRegistry();
  const names = ['p1.png', 'p2.png', 'p3.png', 'p4.png', 'p5.png'];
  const results = await Promise.all(
    names.map((n) => pool.run((lease) => renderOne(lease, job('vaporsoft-favicon.svg', n), { fonts }))),
  );
  assert.equal(results.length, 5);
  for (const r of results) assert.deepEqual(pngSize(r.output), { width: 64, height: 64 });
});

test('output directories are created as needed', async () => {
  const fonts = await emptyRegistry();
  const nested = path.join(outDir, 'deep', 'deeper', 'x.png');
  const result = await pool.run((lease) =>
    renderOne(lease, { input: path.join(FIXTURES, 'vaporsoft-favicon.svg'), output: nested }, { fonts }),
  );
  assert.ok(fs.existsSync(result.output));
});

test('a substituted family is repaired from the cache without any network access', async () => {
  // Pre-populate the cache under the names the SVG prefers. noFetch proves the
  // repair came from disk: any network attempt would be suppressed and fail.
  const cache = path.join(outDir, 'cache-repair');
  const bytes = fs.readFileSync(path.join(FONTS, 'Syncopate-Regular.ttf'));
  for (const family of ['notosansjp', 'notosans']) {
    fs.mkdirSync(path.join(cache, family), { recursive: true });
    fs.writeFileSync(path.join(cache, family, 'F.ttf'), bytes);
  }

  const fonts = await FontRegistry.create({ noFetch: true, env: { CRISPR_CACHE_DIR: cache } });
  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-logo.svg', 'repaired.png'), { fonts }),
  );

  assert.deepEqual(result.fetched.sort(), ['Noto Sans', 'Noto Sans JP']);
  assert.deepEqual(result.substitutions, [], 'repair should clear the substitution');
});

test('an unavailable family is reported rather than silently accepted', async () => {
  const fonts = await FontRegistry.create({
    noFetch: true,
    env: { CRISPR_CACHE_DIR: path.join(outDir, 'cache-none') },
  });
  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-logo.svg', 'unrepaired.png'), { fonts }),
  );

  assert.ok(result.substitutions.length > 0, 'the preferred Noto families are absent and must be reported');
  assert.ok(result.substitutions.every((s) => s.requested[0]!.startsWith('Noto')));
  assert.deepEqual(result.fetched, []);
});

test('--font-fallback satisfies the preferred family with a chosen substitute', async () => {
  const fonts = await FontRegistry.create({
    noFetch: true,
    fallbacks: ['Noto Sans JP=Stand In', 'Noto Sans=Stand In'],
    env: { CRISPR_CACHE_DIR: path.join(outDir, 'cache-fallback') },
  });
  // Cache the substitute under the name the fallback points at.
  const dir = path.join(outDir, 'cache-fallback', 'standin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'F.ttf'), fs.readFileSync(path.join(FONTS, 'Syncopate-Regular.ttf')));

  const result = await pool.run((lease) =>
    renderOne(lease, job('vaporsoft-logo.svg', 'fallback.png'), { fonts }),
  );
  assert.deepEqual(result.substitutions, []);
  assert.ok(result.fetched.every((f) => f.includes('via Stand In')));
});
