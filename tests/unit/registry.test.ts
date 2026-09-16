import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontRegistry } from '../../src/fonts/registry.ts';
import { cacheDir, cachedPath, readCached, writeCached } from '../../src/fonts/cache.ts';
import type { Fetcher } from '../../src/fonts/google.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SYNCOPATE = path.join(here, '..', 'fixtures', 'fonts', 'Syncopate-Regular.ttf');
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';

function tempEnv(t: { after(fn: () => void): void }): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { CRISPR_CACHE_DIR: dir };
}

function stub(map: Record<string, string | Buffer>): { fetch: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetcher = async (url) => {
    calls.push(url);
    const hit = map[url] ?? map[decodeURIComponent(url)];
    if (hit === undefined) {
      return { ok: false, status: 404, buffer: async () => Buffer.alloc(0), text: async () => '' };
    }
    const buf = Buffer.isBuffer(hit) ? hit : Buffer.from(hit);
    return { ok: true, status: 200, buffer: async () => buf, text: async () => buf.toString('utf8') };
  };
  return { fetch, calls };
}

test('a bare font path takes its family from the name table', async (t) => {
  const registry = await FontRegistry.create({ specs: [SYNCOPATE], env: tempEnv(t) });
  assert.deepEqual(registry.families(), ['Syncopate']);
  assert.equal(registry.payloads().length, 1);
  assert.ok(registry.payloads()[0]!.base64.length > 100);
});

test('Family=path overrides the internal name', async (t) => {
  const registry = await FontRegistry.create({ specs: [`Noto Sans=${SYNCOPATE}`], env: tempEnv(t) });
  assert.deepEqual(registry.families(), ['Noto Sans']);
});

test('Family=path splits on the first equals, keeping Windows drive paths intact', async (t) => {
  const registry = await FontRegistry.create({ specs: [`My Font=${SYNCOPATE}`], env: tempEnv(t) });
  assert.ok(registry.has('My Font'));
});

test('a bare woff2 path is a usage error naming the Family=path form', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-woff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const woff2 = path.join(dir, 'Thing-Regular.woff2');
  fs.writeFileSync(woff2, Buffer.from('wOF2 not really'));

  await assert.rejects(
    () => FontRegistry.create({ specs: [woff2], env: tempEnv(t) }),
    /Family=/,
  );
});

test('a missing font file is a usage error naming the path', async (t) => {
  await assert.rejects(
    () => FontRegistry.create({ specs: [path.join(os.tmpdir(), 'no-such-font-x9.ttf')], env: tempEnv(t) }),
    /not found/,
  );
});

test('--font-dir registers every font in the directory', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-fontdir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(SYNCOPATE, path.join(dir, 'Syncopate-Regular.ttf'));
  fs.writeFileSync(path.join(dir, 'README.txt'), 'ignored');

  const registry = await FontRegistry.create({ dirs: [dir], env: tempEnv(t) });
  assert.deepEqual(registry.families(), ['Syncopate']);
});

test('google:Family fetches and registers', async (t) => {
  const { fetch } = stub({
    [`${RAW}/ofl/manrope/METADATA.pb`]: 'fonts {\n filename: "Manrope[wght].ttf"\n}',
    [`${RAW}/ofl/manrope/Manrope[wght].ttf`]: fs.readFileSync(SYNCOPATE),
  });

  const registry = await FontRegistry.create({ specs: ['google:Manrope'], fetch, env: tempEnv(t) });
  assert.ok(registry.has('Manrope'));
});

test('google:Family that cannot be resolved is a usage error', async (t) => {
  const { fetch } = stub({});
  await assert.rejects(
    () => FontRegistry.create({ specs: ['google:Totally Fake'], fetch, env: tempEnv(t) }),
    /could not be resolved/,
  );
});

test('acquire populates the cache, and a second registry reads it without fetching', async (t) => {
  const env = tempEnv(t);
  const { fetch, calls } = stub({
    [`${RAW}/ofl/manrope/METADATA.pb`]: 'fonts {\n filename: "Manrope[wght].ttf"\n}',
    [`${RAW}/ofl/manrope/Manrope[wght].ttf`]: Buffer.from('FONT'),
  });

  const first = await FontRegistry.create({ fetch, env });
  assert.equal((await first.acquire('Manrope')).length, 1);
  const afterFirst = calls.length;
  assert.ok(afterFirst > 0);

  const second = await FontRegistry.create({ fetch, env });
  assert.equal((await second.acquire('Manrope')).length, 1);
  assert.equal(calls.length, afterFirst, 'a cache hit must not fetch');
});

test('a family that cannot be found is attempted once per run', async (t) => {
  const { fetch, calls } = stub({});
  const registry = await FontRegistry.create({ fetch, env: tempEnv(t) });

  assert.deepEqual(await registry.acquire('Ghost Family'), []);
  const afterFirst = calls.length;
  assert.deepEqual(await registry.acquire('Ghost Family'), []);
  assert.equal(calls.length, afterFirst, 'a known miss must not be retried');
});

test('--no-font-fetch suppresses network lookups but still reads the cache', async (t) => {
  const env = tempEnv(t);
  writeCached('Cached Family', [{ name: 'X.ttf', buffer: Buffer.from('BYTES') }], env);
  const { fetch, calls } = stub({});

  const registry = await FontRegistry.create({ noFetch: true, fetch, env });
  assert.equal((await registry.acquire('Cached Family')).length, 1);
  assert.deepEqual(await registry.acquire('Uncached Family'), []);
  assert.equal(calls.length, 0);
});

test('font fallbacks are parsed and exposed', async (t) => {
  const registry = await FontRegistry.create({
    fallbacks: ['Noto Sans JP=Yu Gothic'],
    env: tempEnv(t),
  });
  assert.equal(registry.fallbackFor('Noto Sans JP'), 'Yu Gothic');
  assert.equal(registry.fallbackFor('Something Else'), undefined);
});

test('a malformed font fallback is a usage error', async (t) => {
  const env = tempEnv(t);
  await assert.rejects(() => FontRegistry.create({ fallbacks: ['no-equals'], env }), /Requested=Available/);
  await assert.rejects(() => FontRegistry.create({ fallbacks: ['A='], env }), /Requested=Available/);
});

test('the cache directory honours CRISPR_CACHE_DIR and falls back to LOCALAPPDATA', () => {
  assert.equal(cacheDir({ CRISPR_CACHE_DIR: path.join('C:', 'custom') }), path.resolve('C:', 'custom'));
  assert.equal(
    cacheDir({ LOCALAPPDATA: path.join('C:', 'Users', 'x', 'AppData', 'Local') }),
    path.join('C:', 'Users', 'x', 'AppData', 'Local', 'crispr', 'fonts'),
  );
});

test('cached paths are namespaced by family slug', () => {
  const env = { CRISPR_CACHE_DIR: path.join('C:', 'c') };
  assert.ok(cachedPath('Noto Sans JP', 'F.ttf', env).includes('notosansjp'));
});

test('reading an absent cache yields an empty list rather than throwing', () => {
  assert.deepEqual(readCached('Never Cached', { CRISPR_CACHE_DIR: path.join(os.tmpdir(), 'nope-x9') }), []);
});

test('concurrent requests for the same family share one lookup', async (t) => {
  const { fetch, calls } = stub({
    [`${RAW}/ofl/manrope/METADATA.pb`]: 'fonts {\n filename: "Manrope[wght].ttf"\n}',
    [`${RAW}/ofl/manrope/Manrope[wght].ttf`]: Buffer.from('FONT'),
  });
  const registry = await FontRegistry.create({ fetch, env: tempEnv(t) });

  // Eight pages asking at once, as a real parallel run does. A flag set before
  // the await would leave seven of them empty-handed.
  const all = await Promise.all(Array.from({ length: 8 }, () => registry.acquire('Manrope')));

  for (const payloads of all) assert.equal(payloads.length, 1, 'every caller must get the font');
  assert.equal(calls.length, 2, 'the family should be fetched exactly once');
});

test('a network failure yields no font rather than aborting', async (t) => {
  const failing: Fetcher = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const registry = await FontRegistry.create({ fetch: failing, env: tempEnv(t) });
  assert.deepEqual(await registry.acquire('Anything'), []);
});
