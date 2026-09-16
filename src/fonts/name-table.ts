/**
 * Minimal sfnt `name` table reader.
 *
 * Only exists so `--font <path>` can name a family without the user repeating
 * what the file already knows. Everything here is deliberately defensive: a
 * malformed font must return null, never throw, because the caller's next move
 * is a clear usage error rather than a crash.
 */

/** Typographic family. Preferred, because it is the name a designer actually uses. */
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
/** Legacy family. Present in every font, so it is the fallback. */
const NAME_ID_FAMILY = 1;

const SFNT_TRUETYPE = 0x00010000;
/** 'OTTO' — CFF outlines. */
const SFNT_CFF = 0x4f54544f;
/** 'true' — legacy Apple TrueType. */
const SFNT_TRUE = 0x74727565;

/**
 * Read a font's family name, or null when the buffer is not a parseable sfnt.
 *
 * WOFF and WOFF2 return null by design: their tables are compressed, so reading
 * the name would mean carrying a Brotli decompressor for a string the user can
 * supply with `Family=path` instead.
 */
export function readFamilyName(buf: Buffer): string | null {
  if (buf.length < 12) return null;

  const tag = buf.readUInt32BE(0);
  if (tag !== SFNT_TRUETYPE && tag !== SFNT_CFF && tag !== SFNT_TRUE) return null;

  const table = findTable(buf, 'name');
  if (!table) return null;

  return parseNameTable(buf, table.offset, table.length);
}

interface TableRecord {
  offset: number;
  length: number;
}

/** Locate a table in the sfnt table directory. */
function findTable(buf: Buffer, want: string): TableRecord | null {
  const numTables = buf.readUInt16BE(4);
  const directoryEnd = 12 + numTables * 16;
  if (directoryEnd > buf.length) return null;

  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (buf.toString('latin1', record, record + 4) !== want) continue;

    const offset = buf.readUInt32BE(record + 8);
    const length = buf.readUInt32BE(record + 12);
    if (offset + length > buf.length) return null;
    return { offset, length };
  }
  return null;
}

function parseNameTable(buf: Buffer, offset: number, length: number): string | null {
  if (length < 6) return null;

  const count = buf.readUInt16BE(offset + 2);
  const storage = offset + buf.readUInt16BE(offset + 4);
  const recordsEnd = offset + 6 + count * 12;
  if (recordsEnd > buf.length) return null;

  // Keep both candidates and choose at the end, since records are not ordered
  // by nameID and the typographic family may appear after the legacy one.
  let typographic: string | null = null;
  let legacy: string | null = null;

  for (let i = 0; i < count; i++) {
    const record = offset + 6 + i * 12;
    const nameId = buf.readUInt16BE(record + 6);
    if (nameId !== NAME_ID_TYPOGRAPHIC_FAMILY && nameId !== NAME_ID_FAMILY) continue;

    const platformId = buf.readUInt16BE(record);
    const stringLength = buf.readUInt16BE(record + 8);
    const stringOffset = storage + buf.readUInt16BE(record + 10);
    if (stringOffset + stringLength > buf.length) continue;

    const raw = buf.subarray(stringOffset, stringOffset + stringLength);
    const decoded = decodeName(raw, platformId);
    if (!decoded) continue;

    if (nameId === NAME_ID_TYPOGRAPHIC_FAMILY) typographic ??= decoded;
    else legacy ??= decoded;
  }

  return typographic ?? legacy;
}

/**
 * Platform 3 (Windows) and platform 0 (Unicode) store UTF-16BE. Platform 1
 * (Macintosh) stores a single-byte encoding that is Latin-1 for the Roman
 * script, which is all we need for a family name.
 */
function decodeName(raw: Buffer, platformId: number): string | null {
  const utf16 = platformId === 3 || platformId === 0;
  // swap16 throws on an odd-length buffer, which a malformed font can produce.
  if (utf16 && raw.length % 2 !== 0) return null;

  const text = utf16 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');

  const trimmed = text.replace(/\0/g, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}
