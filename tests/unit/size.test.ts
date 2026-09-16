import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSize, validateSizeOptions, MAX_DIMENSION } from '../../src/size.ts';

const box = { width: 100, height: 50 };

test('no options yields the intrinsic size', () => {
  assert.deepEqual(computeSize(box, {}), { width: 100, height: 50 });
});

test('scale multiplies both axes', () => {
  assert.deepEqual(computeSize(box, { scale: 2 }), { width: 200, height: 100 });
  assert.deepEqual(computeSize(box, { scale: 0.5 }), { width: 50, height: 25 });
});

test('dpi is scale relative to 96', () => {
  assert.deepEqual(computeSize(box, { dpi: 192 }), { width: 200, height: 100 });
  assert.deepEqual(computeSize(box, { dpi: 96 }), { width: 100, height: 50 });
});

test('width pins one axis and derives the other from aspect', () => {
  assert.deepEqual(computeSize(box, { width: 800 }), { width: 800, height: 400 });
});

test('height pins one axis and derives the other from aspect', () => {
  assert.deepEqual(computeSize(box, { height: 400 }), { width: 800, height: 400 });
});

test('width and height together give an exact box, aspect not preserved', () => {
  assert.deepEqual(computeSize(box, { width: 800, height: 100 }), { width: 800, height: 100 });
});

test('rounding is applied once at the end, not per step', () => {
  // 331 * (800/331) must land exactly on 800, never 799 via an intermediate round
  assert.deepEqual(computeSize({ width: 331, height: 331 }, { width: 800 }), { width: 800, height: 800 });
  assert.deepEqual(computeSize({ width: 3, height: 7 }, { scale: 1.5 }), { width: 5, height: 11 });
});

test('non-integer intrinsic sizes are rounded', () => {
  assert.deepEqual(computeSize({ width: 37.78125, height: 18.890625 }, {}), { width: 38, height: 19 });
});

test('dimensions beyond the Chromium texture limit are rejected', () => {
  assert.throws(() => computeSize(box, { width: MAX_DIMENSION + 1 }), /16384/);
  assert.throws(() => computeSize({ width: 10000, height: 10000 }, { scale: 2 }), /20000/);
});

test('a dimension landing exactly on the limit is allowed', () => {
  assert.deepEqual(
    computeSize({ width: 1, height: 1 }, { width: MAX_DIMENSION, height: MAX_DIMENSION }),
    { width: MAX_DIMENSION, height: MAX_DIMENSION },
  );
});

test('a size that rounds to zero is rejected', () => {
  assert.throws(() => computeSize(box, { scale: 0.001 }), /rounds to zero/i);
});

test('intrinsic sizes of zero are rejected', () => {
  assert.throws(() => computeSize({ width: 0, height: 0 }, {}), /no resolvable dimensions/i);
});

test('conflicting sizing flags are a usage error', () => {
  assert.throws(() => validateSizeOptions({ scale: 2, width: 800 }), /--scale/);
  assert.throws(() => validateSizeOptions({ dpi: 192, height: 400 }), /--dpi/);
  assert.throws(() => validateSizeOptions({ scale: 2, dpi: 192 }), /--scale/);
});

test('width together with height is not a conflict', () => {
  assert.doesNotThrow(() => validateSizeOptions({ width: 800, height: 100 }));
});

test('non-positive and non-finite flag values are rejected', () => {
  assert.throws(() => validateSizeOptions({ scale: 0 }), /positive/);
  assert.throws(() => validateSizeOptions({ scale: -1 }), /positive/);
  assert.throws(() => validateSizeOptions({ width: 0 }), /positive/);
  assert.throws(() => validateSizeOptions({ dpi: Number.NaN }), /positive/);
  assert.throws(() => validateSizeOptions({ height: Number.POSITIVE_INFINITY }), /positive/);
});
