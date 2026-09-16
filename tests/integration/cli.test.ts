import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures', 'brand');
const ENTRY = path.join(here, '..', '..', 'src', 'main.ts');

function tempOut(t: { after(fn: () => void): void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Run the CLI as a real child process.
 *
 * Spawning rather than calling main() in-process keeps the test runner's own
 * stdout intact, and exercises argument handling and the exit code the way a
 * user actually meets them.
 */
async function capture(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...argv], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, out: stdout, err: stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

test('converts a directory of fixtures and exits zero', async (t) => {
  const out = tempOut(t);
  const { code } = await capture([FIXTURES, '-o', out, '--no-font-fetch']);

  assert.equal(code, 0);
  const produced = fs.readdirSync(out).sort();
  assert.deepEqual(produced, [
    'akira-icon.png',
    'vaporsoft-banner.png',
    'vaporsoft-favicon.png',
    'vaporsoft-logo.png',
  ]);
  assert.deepEqual(pngSize(path.join(out, 'akira-icon.png')), { width: 256, height: 256 });
  assert.deepEqual(pngSize(path.join(out, 'vaporsoft-banner.png')), { width: 1000, height: 200 });
});

test('--scale applies to every file in the batch', async (t) => {
  const out = tempOut(t);
  const { code } = await capture([FIXTURES, '-o', out, '--scale', '2', '--no-font-fetch']);

  assert.equal(code, 0);
  assert.deepEqual(pngSize(path.join(out, 'akira-icon.png')), { width: 512, height: 512 });
  assert.deepEqual(pngSize(path.join(out, 'vaporsoft-favicon.png')), { width: 128, height: 128 });
});

test('a single file input converts on its own', async (t) => {
  const out = tempOut(t);
  const { code } = await capture([
    path.join(FIXTURES, 'vaporsoft-favicon.svg'), '-o', out, '--no-font-fetch',
  ]);

  assert.equal(code, 0);
  assert.deepEqual(fs.readdirSync(out), ['vaporsoft-favicon.png']);
});

test('--recursive mirrors a nested tree into the output', async (t) => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-src-'));
  t.after(() => fs.rmSync(src, { recursive: true, force: true }));
  fs.mkdirSync(path.join(src, 'brand', 'deep'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'vaporsoft-favicon.svg'), path.join(src, 'top.svg'));
  fs.copyFileSync(path.join(FIXTURES, 'vaporsoft-favicon.svg'), path.join(src, 'brand', 'mid.svg'));
  fs.copyFileSync(path.join(FIXTURES, 'vaporsoft-favicon.svg'), path.join(src, 'brand', 'deep', 'low.svg'));

  const out = tempOut(t);
  const { code } = await capture([src, '-o', out, '-r', '--no-font-fetch']);

  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(out, 'top.png')));
  assert.ok(fs.existsSync(path.join(out, 'brand', 'mid.png')));
  assert.ok(fs.existsSync(path.join(out, 'brand', 'deep', 'low.png')));
});

test('non-svg files in the input directory are ignored', async (t) => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-mixed-'));
  t.after(() => fs.rmSync(src, { recursive: true, force: true }));
  fs.copyFileSync(path.join(FIXTURES, 'vaporsoft-favicon.svg'), path.join(src, 'keep.svg'));
  fs.writeFileSync(path.join(src, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(src, 'photo.jpg'), 'x');

  const out = tempOut(t);
  const { code } = await capture([src, '-o', out, '--no-font-fetch']);

  assert.equal(code, 0);
  assert.deepEqual(fs.readdirSync(out), ['keep.png']);
});

test('a directory with no svg files exits one and says so', async (t) => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-none-'));
  t.after(() => fs.rmSync(src, { recursive: true, force: true }));
  fs.writeFileSync(path.join(src, 'readme.md'), 'x');

  const { code, err } = await capture([src, '-o', tempOut(t)]);
  assert.equal(code, 1);
  assert.match(err, /no \.svg files found/);
});

test('a malformed file fails alone without aborting the batch', async (t) => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-bad-'));
  t.after(() => fs.rmSync(src, { recursive: true, force: true }));
  fs.copyFileSync(path.join(FIXTURES, 'vaporsoft-favicon.svg'), path.join(src, 'good.svg'));
  // No width, no height, no viewBox: nothing to derive a size from.
  fs.writeFileSync(path.join(src, 'sizeless.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

  const out = tempOut(t);
  const { code, err } = await capture([src, '-o', out, '--no-font-fetch']);

  assert.equal(code, 1, 'the run should report failure');
  assert.ok(fs.existsSync(path.join(out, 'good.png')), 'the good file must still convert');
  assert.match(err, /sizeless\.svg/);
  assert.match(err, /1 converted, 1 failed/);
});

test('a substituted font warns but still exits zero', async (t) => {
  const out = tempOut(t);
  const { code, err } = await capture([
    path.join(FIXTURES, 'vaporsoft-logo.svg'), '-o', out, '--no-font-fetch',
  ]);

  assert.equal(code, 0);
  assert.match(err, /warning:.*substituted fonts/s);
  assert.match(err, /wanted Noto Sans/);
});

test('--strict-fonts turns that warning into a failure', async (t) => {
  const out = tempOut(t);
  const { code, err } = await capture([
    path.join(FIXTURES, 'vaporsoft-logo.svg'), '-o', out, '--no-font-fetch', '--strict-fonts',
  ]);

  assert.equal(code, 1);
  assert.match(err, /error:.*substituted fonts/s);
});

test('--list-fonts reports without writing any PNG', async (t) => {
  const out = tempOut(t);
  const { code, out: stdout } = await capture([FIXTURES, '-o', out, '--list-fonts']);

  assert.equal(code, 0);
  assert.match(stdout, /vaporsoft-logo\.svg/);
  assert.match(stdout, /wanted Noto Sans/);
  assert.match(stdout, /all preferred families resolved/);
});

test('--help and --version write to stdout and exit zero', async () => {
  const help = await capture(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /Usage/);

  const version = await capture(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.out, /^\d+\.\d+\.\d+/);
});

test('a usage error exits two before any browser starts', async () => {
  const { code, err } = await capture(['a.svg', '--scale', '2', '--width', '800']);
  assert.equal(code, 2);
  assert.match(err, /--scale/);
});

test('a missing input path exits two and names the path', async (t) => {
  const { code, err } = await capture([path.join(os.tmpdir(), 'crispr-absent-zz'), '-o', tempOut(t)]);
  assert.equal(code, 2);
  assert.match(err, /crispr-absent-zz/);
});

test('--quiet stays silent on a clean run', async (t) => {
  const out = tempOut(t);
  const { code, err } = await capture([
    path.join(FIXTURES, 'vaporsoft-favicon.svg'), '-o', out, '--quiet', '--no-font-fetch',
  ]);
  assert.equal(code, 0);
  assert.equal(err.trim(), '');
});

test('--background produces a different image than the transparent default', async (t) => {
  const out = tempOut(t);
  await capture([path.join(FIXTURES, 'akira-icon.svg'), '-o', out, '--no-font-fetch']);
  const bare = fs.readFileSync(path.join(out, 'akira-icon.png'));

  const out2 = tempOut(t);
  await capture([
    path.join(FIXTURES, 'akira-icon.svg'), '-o', out2, '--background', '#ff00ff', '--no-font-fetch',
  ]);
  const painted = fs.readFileSync(path.join(out2, 'akira-icon.png'));

  assert.notEqual(bare.toString('base64'), painted.toString('base64'));
});

test('-j 1 renders the same output as the parallel default', async (t) => {
  const serial = tempOut(t);
  const parallel = tempOut(t);
  await capture([FIXTURES, '-o', serial, '-j', '1', '--no-font-fetch']);
  await capture([FIXTURES, '-o', parallel, '-j', '4', '--no-font-fetch']);

  for (const name of fs.readdirSync(serial)) {
    assert.deepEqual(
      pngSize(path.join(serial, name)),
      pngSize(path.join(parallel, name)),
      `${name} should not depend on job count`,
    );
  }
});
