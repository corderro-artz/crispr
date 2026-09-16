import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFamilyName } from '../../src/fonts/name-table.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'fonts', 'Syncopate-Regular.ttf');

test('reads the family name from a real TrueType font', () => {
  assert.equal(readFamilyName(fs.readFileSync(fixture)), 'Syncopate');
});

test('returns null for a buffer that is not sfnt', () => {
  assert.equal(readFamilyName(Buffer.from('this is not a font at all, truly')), null);
});

test('returns null for an empty buffer rather than throwing', () => {
  assert.equal(readFamilyName(Buffer.alloc(0)), null);
});

test('returns null for a truncated font rather than throwing', () => {
  const truncated = fs.readFileSync(fixture).subarray(0, 40);
  assert.equal(readFamilyName(truncated), null);
});

test('returns null when the table directory points past the buffer', () => {
  // Valid sfnt header claiming one table whose offset is nonsense.
  const buf = Buffer.alloc(28);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(1, 4);
  buf.write('name', 12, 'latin1');
  buf.writeUInt32BE(0xffffff, 20); // offset
  buf.writeUInt32BE(0xffffff, 24); // length
  assert.equal(readFamilyName(buf), null);
});

test('WOFF2 is rejected rather than misparsed', () => {
  const woff2 = Buffer.alloc(16);
  woff2.write('wOF2', 0, 'latin1');
  assert.equal(readFamilyName(woff2), null);
});

test('an odd-length UTF-16 name record does not throw', () => {
  // numTables=1, name table with one Windows record whose string length is odd.
  const nameTable = Buffer.alloc(6 + 12 + 5);
  nameTable.writeUInt16BE(0, 0); // format
  nameTable.writeUInt16BE(1, 2); // count
  nameTable.writeUInt16BE(6 + 12, 4); // storage offset
  nameTable.writeUInt16BE(3, 6 + 0); // platformId: Windows
  nameTable.writeUInt16BE(1, 6 + 2); // encodingId
  nameTable.writeUInt16BE(0x409, 6 + 4); // languageId
  nameTable.writeUInt16BE(1, 6 + 6); // nameId: family
  nameTable.writeUInt16BE(5, 6 + 8); // length: odd on purpose
  nameTable.writeUInt16BE(0, 6 + 10); // offset
  nameTable.write('abcde', 6 + 12, 'latin1');

  const buf = Buffer.concat([Buffer.alloc(28), nameTable]);
  buf.writeUInt32BE(0x00010000, 0);
  buf.writeUInt16BE(1, 4);
  buf.write('name', 12, 'latin1');
  buf.writeUInt32BE(28, 20);
  buf.writeUInt32BE(nameTable.length, 24);

  assert.doesNotThrow(() => readFamilyName(buf));
  assert.equal(readFamilyName(buf), null);
});
