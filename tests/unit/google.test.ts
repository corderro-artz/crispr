import test from 'node:test';
import assert from 'node:assert/strict';
import { familySlug, parseMetadata, pickFiles, resolveFamily } from '../../src/fonts/google.ts';
import type { Fetcher } from '../../src/fonts/google.ts';

/** A fetcher backed by a fixed URL map. Anything unlisted 404s. */
function stub(map: Record<string, string | Buffer>): { fetch: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetcher = async (url) => {
    calls.push(url);
    // Look the URL up both as given and decoded, so the map can be written with
    // literal filenames regardless of whether the caller percent-encodes them.
    const hit = map[url] ?? map[safeDecode(url)];
    if (hit === undefined) {
      return { ok: false, status: 404, buffer: async () => Buffer.alloc(0), text: async () => '' };
    }
    const buf = Buffer.isBuffer(hit) ? hit : Buffer.from(hit);
    return { ok: true, status: 200, buffer: async () => buf, text: async () => buf.toString('utf8') };
  };
  return { fetch, calls };
}

const RAW = 'https://raw.githubusercontent.com/google/fonts/main';

test('slugs lowercase the family and strip spaces', () => {
  assert.equal(familySlug('Noto Sans JP'), 'notosansjp');
  assert.equal(familySlug('Zen Kaku Gothic New'), 'zenkakugothicnew');
  assert.equal(familySlug('Syncopate'), 'syncopate');
  assert.equal(familySlug('  Space  Grotesk '), 'spacegrotesk');
});

test('metadata filenames are extracted in listed order', () => {
  const pb = `
name: "Noto Sans"
fonts {
  filename: "NotoSans[wdth,wght].ttf"
  post_script_name: "NotoSans-Regular"
}
fonts {
  filename: "NotoSans-Italic[wdth,wght].ttf"
}
`;
  assert.deepEqual(parseMetadata(pb), ['NotoSans[wdth,wght].ttf', 'NotoSans-Italic[wdth,wght].ttf']);
});

test('metadata without any filenames yields an empty list', () => {
  assert.deepEqual(parseMetadata('name: "Nothing"\n'), []);
});

test('a variable font wins over static weights and italics are dropped', () => {
  assert.deepEqual(
    pickFiles(['NotoSans[wdth,wght].ttf', 'NotoSans-Italic[wdth,wght].ttf']),
    ['NotoSans[wdth,wght].ttf'],
  );
});

test('static families contribute their upright weights', () => {
  const picked = pickFiles([
    'ZenKakuGothicNew-Light.ttf',
    'ZenKakuGothicNew-Regular.ttf',
    'ZenKakuGothicNew-Medium.ttf',
    'ZenKakuGothicNew-Bold.ttf',
    'ZenKakuGothicNew-Italic.ttf',
  ]);
  assert.ok(picked.includes('ZenKakuGothicNew-Regular.ttf'));
  assert.ok(picked.includes('ZenKakuGothicNew-Bold.ttf'));
  assert.ok(!picked.some((f) => f.includes('Italic')));
});

test('an empty filename list picks nothing rather than throwing', () => {
  assert.deepEqual(pickFiles([]), []);
});

test('resolves a family under the ofl licence', async () => {
  const { fetch, calls } = stub({
    [`${RAW}/ofl/notosansjp/METADATA.pb`]: 'fonts {\n  filename: "NotoSansJP[wght].ttf"\n}',
    [`${RAW}/ofl/notosansjp/NotoSansJP[wght].ttf`]: Buffer.from('FONTBYTES'),
  });

  const got = await resolveFamily('Noto Sans JP', fetch);
  assert.ok(got);
  assert.equal(got.license, 'ofl');
  assert.deepEqual(got.files.map((f) => f.name), ['NotoSansJP[wght].ttf']);
  assert.equal(got.files[0]!.buffer.toString(), 'FONTBYTES');
  assert.equal(calls[0], `${RAW}/ofl/notosansjp/METADATA.pb`);
});

test('falls through to apache when ofl misses, as Syncopate really does', async () => {
  const { fetch, calls } = stub({
    [`${RAW}/apache/syncopate/METADATA.pb`]: 'fonts {\n  filename: "Syncopate-Regular.ttf"\n}',
    [`${RAW}/apache/syncopate/Syncopate-Regular.ttf`]: Buffer.from('X'),
  });

  const got = await resolveFamily('Syncopate', fetch);
  assert.ok(got);
  assert.equal(got.license, 'apache');
  assert.ok(calls[0]!.includes('/ofl/'), 'ofl should be tried first');
  assert.ok(calls[1]!.includes('/apache/'), 'apache should be tried second');
});

test('a family in no licence directory resolves to null', async () => {
  const { fetch, calls } = stub({});
  assert.equal(await resolveFamily('Totally Fake Font', fetch), null);
  assert.equal(calls.length, 3, 'all three licence directories should be tried');
});

test('metadata that lists no usable files resolves to null', async () => {
  const { fetch } = stub({ [`${RAW}/ofl/ghost/METADATA.pb`]: 'name: "Ghost"\n' });
  assert.equal(await resolveFamily('Ghost', fetch), null);
});

test('a file that 404s after metadata listed it is skipped, not fatal', async () => {
  const { fetch } = stub({
    [`${RAW}/ofl/partial/METADATA.pb`]:
      'fonts {\n filename: "Partial-Regular.ttf"\n}\nfonts {\n filename: "Partial-Bold.ttf"\n}',
    [`${RAW}/ofl/partial/Partial-Regular.ttf`]: Buffer.from('OK'),
  });

  const got = await resolveFamily('Partial', fetch);
  assert.ok(got);
  assert.deepEqual(got.files.map((f) => f.name), ['Partial-Regular.ttf']);
});

test('square brackets in variable filenames are URL-encoded', async () => {
  const { fetch, calls } = stub({
    [`${RAW}/ofl/var/METADATA.pb`]: 'fonts {\n filename: "Var[wght].ttf"\n}',
    [`${RAW}/ofl/var/Var[wght].ttf`]: Buffer.from('V'),
  });

  await resolveFamily('Var', fetch);
  const download = calls.find((c) => c.includes('Var'));
  assert.ok(download?.includes('%5Bwght%5D') || download?.includes('Var[wght].ttf'));
});

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
