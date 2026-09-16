import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover } from '../../src/discover.ts';

/** Build a throwaway tree and return its root. Registered for cleanup by the caller. */
function tree(spec: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crispr-discover-'));
  for (const [rel, body] of Object.entries(spec)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

test('a flat directory contributes its svg children', (t) => {
  const root = tree({ 'a.svg': SVG, 'b.svg': SVG, 'notes.txt': 'x' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const jobs = discover([root], path.join(root, 'out'), false);
  assert.deepEqual(jobs.map((j) => path.basename(j.input)).sort(), ['a.svg', 'b.svg']);
  assert.deepEqual(jobs.map((j) => path.basename(j.output)).sort(), ['a.png', 'b.png']);
});

test('non-svg files are skipped silently', (t) => {
  const root = tree({ 'a.svg': SVG, 'b.png': 'x', 'c.jpg': 'x', 'd': 'x' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(discover([root], path.join(root, 'out'), false).length, 1);
});

test('extension matching is case-insensitive', (t) => {
  const root = tree({ 'a.SVG': SVG, 'b.Svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(discover([root], path.join(root, 'out'), false).length, 2);
});

test('without recursive, subdirectories are not descended into', (t) => {
  const root = tree({ 'a.svg': SVG, 'sub/b.svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const jobs = discover([root], path.join(root, 'out'), false);
  assert.deepEqual(jobs.map((j) => path.basename(j.input)), ['a.svg']);
});

test('recursive descends and mirrors the tree under the output directory', (t) => {
  const root = tree({ 'a.svg': SVG, 'sub/b.svg': SVG, 'sub/deep/c.svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'out');

  const jobs = discover([root], out, true);
  const rels = jobs.map((j) => path.relative(out, j.output).split(path.sep).join('/')).sort();
  assert.deepEqual(rels, ['a.png', 'sub/b.png', 'sub/deep/c.png']);
});

test('a single file input is converted on its own', (t) => {
  const root = tree({ 'logo.svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, 'out');

  const jobs = discover([path.join(root, 'logo.svg')], out, false);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.output, path.join(out, 'logo.png'));
});

test('a non-svg file named explicitly is still skipped', (t) => {
  const root = tree({ 'notes.txt': 'x' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(discover([path.join(root, 'notes.txt')], path.join(root, 'out'), false), []);
});

test('multiple inputs mixing files and directories are combined', (t) => {
  const root = tree({ 'one/a.svg': SVG, 'two/b.svg': SVG, 'loose.svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const jobs = discover(
    [path.join(root, 'one'), path.join(root, 'two'), path.join(root, 'loose.svg')],
    path.join(root, 'out'),
    false,
  );
  assert.deepEqual(jobs.map((j) => path.basename(j.input)).sort(), ['a.svg', 'b.svg', 'loose.svg']);
});

test('duplicate inputs are de-duplicated', (t) => {
  const root = tree({ 'a.svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const jobs = discover([root, path.join(root, 'a.svg')], path.join(root, 'out'), false);
  assert.equal(jobs.length, 1);
});

test('a missing path throws and names the path', () => {
  const missing = path.join(os.tmpdir(), 'crispr-does-not-exist-9e8d7c');
  assert.throws(() => discover([missing], 'out', false), new RegExp('crispr-does-not-exist-9e8d7c'));
});

test('results are ordered deterministically', (t) => {
  const root = tree({ 'c.svg': SVG, 'a.svg': SVG, 'b.svg': SVG });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const names = () => discover([root], path.join(root, 'out'), false).map((j) => path.basename(j.input));
  assert.deepEqual(names(), ['a.svg', 'b.svg', 'c.svg']);
  assert.deepEqual(names(), names());
});
