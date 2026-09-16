import test from 'node:test';
import assert from 'node:assert/strict';
import { fontReport, summarize } from '../../src/report.ts';
import type { RenderResult } from '../../src/render.ts';

function result(over: Partial<RenderResult> = {}): RenderResult {
  return {
    input: 'C:\\in\\logo.svg',
    output: 'C:\\out\\logo.png',
    width: 100,
    height: 50,
    substitutions: [],
    fetched: [],
    ...over,
  };
}

const plain = { strictFonts: false, quiet: false, verbose: false };

test('a clean run exits zero', () => {
  const summary = summarize([result()], [], plain);
  assert.equal(summary.exitCode, 0);
  assert.match(summary.text, /1 converted/);
});

test('a failure exits one and names the file', () => {
  const summary = summarize([result()], [{ input: 'C:\\in\\bad.svg', reason: 'boom' }], plain);
  assert.equal(summary.exitCode, 1);
  assert.match(summary.text, /bad\.svg: boom/);
  assert.match(summary.text, /1 failed/);
});

test('a substitution warns but does not fail by default', () => {
  const summary = summarize(
    [result({ substitutions: [{ text: 'AKIRA', requested: ['Noto Sans'], actual: ['Yu Gothic'] }] })],
    [],
    plain,
  );
  assert.equal(summary.exitCode, 0);
  assert.match(summary.text, /warning:/);
  assert.match(summary.text, /wanted Noto Sans, got Yu Gothic/);
});

test('--strict-fonts promotes a substitution to a failure', () => {
  const summary = summarize(
    [result({ substitutions: [{ text: 'AKIRA', requested: ['Noto Sans'], actual: ['Yu Gothic'] }] })],
    [],
    { ...plain, strictFonts: true },
  );
  assert.equal(summary.exitCode, 1);
  assert.match(summary.text, /error:/);
});

test('fetched families are reported once, sorted', () => {
  const summary = summarize(
    [result({ fetched: ['Noto Sans JP'] }), result({ fetched: ['Noto Sans JP', 'Noto Sans'] })],
    [],
    plain,
  );
  assert.match(summary.text, /fetched 2 font families: Noto Sans, Noto Sans JP/);
});

test('a single fetched family is described in the singular', () => {
  const summary = summarize([result({ fetched: ['Manrope'] })], [], plain);
  assert.match(summary.text, /fetched 1 font family: Manrope/);
});

test('quiet suppresses the tally but never an error', () => {
  const clean = summarize([result()], [], { ...plain, quiet: true });
  assert.equal(clean.text, '');

  const broken = summarize([], [{ input: 'x.svg', reason: 'nope' }], { ...plain, quiet: true });
  assert.match(broken.text, /nope/);
  assert.equal(broken.exitCode, 1);
});

test('verbose lists each file with its dimensions', () => {
  const summary = summarize([result({ width: 512, height: 512 })], [], { ...plain, verbose: true });
  assert.match(summary.text, /logo\.svg -> 512x512/);
});

test('an unpinned browser is called out', () => {
  const summary = summarize([result()], [], { ...plain, unpinnedBrowser: 'system msedge' });
  assert.match(summary.text, /warning: using system msedge/);
  assert.equal(summary.exitCode, 0, 'a drift warning must not fail the run');
});

test('long text in a substitution is truncated', () => {
  const long = 'A'.repeat(80);
  const summary = summarize(
    [result({ substitutions: [{ text: long, requested: ['X'], actual: ['Y'] }] })],
    [],
    plain,
  );
  assert.ok(!summary.text.includes(long));
  assert.match(summary.text, /…/);
});

test('the font report names resolved and unresolved files', () => {
  const text = fontReport([
    result({ input: 'ok.svg' }),
    result({ input: 'bad.svg', substitutions: [{ text: 'HI', requested: ['Noto Sans'], actual: ['Arial'] }] }),
  ]);
  assert.match(text, /ok\.svg/);
  assert.match(text, /all preferred families resolved/);
  assert.match(text, /wanted Noto Sans\s+got Arial/);
});
