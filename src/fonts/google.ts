/**
 * Resolving a font family from the `google/fonts` repository.
 *
 * Deliberately not the Google Fonts Web API (needs a key) and not the GitHub
 * contents API (rate-limits unauthenticated callers at 60/hour). Reading
 * raw.githubusercontent.com has neither restriction.
 *
 * Also deliberately not the CSS endpoint: for CJK families it returns over a
 * hundred unicode-range subsets per weight, which would mean managing subset
 * selection at runtime for no benefit. The unsubsetted TTF is one download.
 */

const RAW_BASE = 'https://raw.githubusercontent.com/google/fonts/main';

/**
 * Licence directories, in the order they are tried. The fallback is not
 * theoretical: most families live under `ofl`, but Syncopate is under `apache`.
 */
const LICENSES = ['ofl', 'apache', 'ufl'] as const;

/** The subset of a fetch response this module needs, so tests can supply their own. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  buffer(): Promise<Buffer>;
  text(): Promise<string>;
}

export type Fetcher = (url: string) => Promise<FetchResponse>;

export interface ResolvedFamily {
  license: string;
  files: { name: string; buffer: Buffer }[];
}

/** The directory name a family uses in the repository: lowercased, spaces removed. */
export function familySlug(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '');
}

/** Pull `filename:` values out of a METADATA.pb, preserving their listed order. */
export function parseMetadata(pb: string): string[] {
  return [...pb.matchAll(/filename:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * Choose which of a family's files to download.
 *
 * A variable font — recognisable by the axis list in brackets — covers every
 * weight in one file, so it is taken alone. Otherwise the upright static weights
 * are taken. Italics are always dropped: an SVG asking for italic text gets it
 * through synthesis, and downloading a second full CJK face to avoid that is a
 * poor trade.
 */
export function pickFiles(filenames: string[]): string[] {
  const upright = filenames.filter((f) => !/italic/i.test(f));

  const variable = upright.filter((f) => f.includes('['));
  if (variable.length > 0) return variable.slice(0, 1);

  return upright;
}

/**
 * Find a family in the repository and download its files.
 *
 * Returns null when the family is absent from every licence directory, which is
 * how a typo or a non-Google font is distinguished from a network failure — the
 * latter rejects instead.
 *
 * A file that 404s after metadata listed it is skipped rather than fatal: a
 * partially available family is still more correct than a substituted one.
 */
export async function resolveFamily(family: string, fetch: Fetcher): Promise<ResolvedFamily | null> {
  const slug = familySlug(family);

  for (const license of LICENSES) {
    const metadata = await fetch(`${RAW_BASE}/${license}/${slug}/METADATA.pb`);
    if (!metadata.ok) continue;

    const wanted = pickFiles(parseMetadata(await metadata.text()));
    const files: { name: string; buffer: Buffer }[] = [];

    for (const name of wanted) {
      const response = await fetch(`${RAW_BASE}/${license}/${slug}/${encodeURIComponent(name)}`);
      if (!response.ok) continue;
      files.push({ name, buffer: await response.buffer() });
    }

    return files.length > 0 ? { license, files } : null;
  }

  return null;
}

/** The default fetcher, wrapping the platform `fetch`. */
export const httpFetch: Fetcher = async (url) => {
  const response = await globalThis.fetch(url);
  return {
    ok: response.ok,
    status: response.status,
    buffer: async () => Buffer.from(await response.arrayBuffer()),
    text: async () => response.text(),
  };
};
