import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultOutDir, helpText, parseCliArgs, VERSION } from '../../src/cli.ts';

/** Narrow a parse result to a run, failing loudly when it is not one. */
function run(argv: string[]) {
  const parsed = parseCliArgs(argv);
  assert.equal(parsed.kind, 'run');
  return (parsed as Extract<typeof parsed, { kind: 'run' }>).options;
}

test('positional paths become inputs', () => {
  assert.deepEqual(run(['a.svg', 'b/']).inputs, ['a.svg', 'b/']);
});

test('no inputs is a usage error', () => {
  assert.throws(() => parseCliArgs([]), /no input paths/);
});

test('-h is help and -H is height', () => {
  assert.equal(parseCliArgs(['-h']).kind, 'help');
  assert.equal(run(['a.svg', '-H', '400']).height, 400);
});

test('--version reports the package version', () => {
  const parsed = parseCliArgs(['--version']);
  assert.equal(parsed.kind, 'version');
  assert.equal((parsed as Extract<typeof parsed, { kind: 'version' }>).text, VERSION);
});

test('help and version win over missing inputs', () => {
  assert.equal(parseCliArgs(['--help']).kind, 'help');
  assert.equal(parseCliArgs(['-V']).kind, 'version');
});

test('short and long forms agree', () => {
  assert.deepEqual(run(['a.svg', '-s', '2']).scale, run(['a.svg', '--scale', '2']).scale);
  assert.deepEqual(run(['a.svg', '-w', '800']).width, run(['a.svg', '--width', '800']).width);
  assert.deepEqual(run(['a.svg', '-o', 'x']).out, run(['a.svg', '--out', 'x']).out);
  assert.equal(run(['a.svg', '-r']).recursive, true);
});

test('sizing flags are parsed as numbers', () => {
  const opts = run(['a.svg', '--dpi', '192']);
  assert.equal(opts.dpi, 192);
  assert.equal(typeof opts.dpi, 'number');
});

test('a non-numeric sizing value is a usage error naming the flag', () => {
  assert.throws(() => parseCliArgs(['a.svg', '--scale', 'big']), /--scale expects a number/);
});

test('conflicting sizing flags are rejected before anything runs', () => {
  assert.throws(() => parseCliArgs(['a.svg', '--scale', '2', '--width', '800']), /--scale/);
  assert.throws(() => parseCliArgs(['a.svg', '--dpi', '192', '--height', '400']), /--dpi/);
});

test('width together with height is accepted', () => {
  const opts = run(['a.svg', '--width', '800', '--height', '100']);
  assert.equal(opts.width, 800);
  assert.equal(opts.height, 100);
});

test('unknown flags are rejected with a pointer to help', () => {
  assert.throws(() => parseCliArgs(['a.svg', '--nope']), /--help/);
});

test('font flags accumulate', () => {
  const opts = run(['a.svg', '--font', 'x.ttf', '--font', 'Y=z.ttf', '--font-dir', 'd', '--font-fallback', 'A=B']);
  assert.deepEqual(opts.fontSpecs, ['x.ttf', 'Y=z.ttf']);
  assert.deepEqual(opts.fontDirs, ['d']);
  assert.deepEqual(opts.fontFallbacks, ['A=B']);
});

test('font booleans default off and flip on', () => {
  const bare = run(['a.svg']);
  assert.equal(bare.noFontFetch, false);
  assert.equal(bare.strictFonts, false);
  assert.equal(bare.listFonts, false);

  const set = run(['a.svg', '--no-font-fetch', '--strict-fonts', '--list-fonts']);
  assert.equal(set.noFontFetch, true);
  assert.equal(set.strictFonts, true);
  assert.equal(set.listFonts, true);
});

test('jobs defaults into range and rejects nonsense', () => {
  const opts = run(['a.svg']);
  assert.ok(opts.jobs >= 1 && opts.jobs <= 8);

  assert.equal(run(['a.svg', '-j', '3']).jobs, 3);
  assert.throws(() => parseCliArgs(['a.svg', '-j', '0']), /between 1 and 64/);
  assert.throws(() => parseCliArgs(['a.svg', '-j', '999']), /between 1 and 64/);
  assert.throws(() => parseCliArgs(['a.svg', '-j', '2.5']), /whole number/);
});

test('quiet and verbose together is a usage error', () => {
  assert.throws(() => parseCliArgs(['a.svg', '--quiet', '--verbose']), /--quiet cannot be combined/);
});

test('the default output directory sits beside the executable', () => {
  assert.equal(
    defaultOutDir(path.join('C:', 'tools', 'crispr.exe'), undefined),
    path.join('C:', 'tools', 'crispr-out'),
  );
});

test('run through node, the default output sits beside the script', () => {
  assert.equal(
    defaultOutDir(path.join('C:', 'Program Files', 'nodejs', 'node.exe'), path.join('D:', 'proj', 'dist', 'crispr.js')),
    path.join('D:', 'proj', 'dist', 'crispr-out'),
  );
});

test('help text documents every flag the parser accepts', () => {
  const text = helpText();
  for (const flag of [
    '--out', '--recursive', '--scale', '--width', '--height', '--dpi', '--background',
    '--font', '--font-dir', '--font-fallback', '--no-font-fetch', '--strict-fonts',
    '--list-fonts', '--jobs', '--browser-path', '--quiet', '--verbose', '--help', '--version',
  ]) {
    assert.ok(text.includes(flag), `help text is missing ${flag}`);
  }
});
