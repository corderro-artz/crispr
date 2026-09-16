/**
 * Collecting fonts from flags and, on demand, from Google Fonts.
 *
 * A page needs fonts as base64 payloads it can hand to `FontFace`. Data URIs are
 * used rather than `file://` URLs because a `file://` document cannot fetch
 * sibling `file://` resources without weakening Chromium's security flags.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readFamilyName } from './name-table.ts';
import { httpFetch, resolveFamily, type Fetcher } from './google.ts';
import { readCached, writeCached } from './cache.ts';

export interface FontPayload {
  family: string;
  base64: string;
}

/** Formats whose tables are compressed, so the family name cannot be read from them. */
const COMPRESSED = new Set(['.woff', '.woff2']);

export interface RegistryOptions {
  /** `--font` values: a path, `Family=path`, or `google:Family`. */
  specs?: string[];
  /** `--font-dir` values. */
  dirs?: string[];
  /** `--font-fallback` values: `Requested=Available`. */
  fallbacks?: string[];
  /** Disable automatic Google Fonts lookups. */
  noFetch?: boolean;
  fetch?: Fetcher;
  env?: NodeJS.ProcessEnv;
}

export class FontRegistry {
  /** Families supplied up front, ready to register on any page. */
  readonly #payloads = new Map<string, FontPayload[]>();
  /** Families already looked up, including misses, so a miss costs one lookup per run. */
  readonly #attempted = new Set<string>();
  readonly #fallbacks: Map<string, string>;
  readonly #noFetch: boolean;
  readonly #fetch: Fetcher;
  readonly #env: NodeJS.ProcessEnv | undefined;

  private constructor(opts: RegistryOptions, fallbacks: Map<string, string>) {
    this.#fallbacks = fallbacks;
    this.#noFetch = opts.noFetch ?? false;
    this.#fetch = opts.fetch ?? httpFetch;
    this.#env = opts.env;
  }

  static async create(opts: RegistryOptions = {}): Promise<FontRegistry> {
    const registry = new FontRegistry(opts, parseFallbacks(opts.fallbacks ?? []));

    for (const dir of opts.dirs ?? []) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!isFontFile(entry.name)) continue;
        registry.#addFile(path.join(dir, entry.name), null);
      }
    }

    for (const spec of opts.specs ?? []) {
      await registry.#addSpec(spec);
    }

    return registry;
  }

  /** Families supplied up front. */
  families(): string[] {
    return [...this.#payloads.keys()];
  }

  /** Every payload that should be registered on a fresh page. */
  payloads(): FontPayload[] {
    return [...this.#payloads.values()].flat();
  }

  has(family: string): boolean {
    return this.#payloads.has(family);
  }

  /** The family a `--font-fallback` remaps this one to, if any. */
  fallbackFor(family: string): string | undefined {
    return this.#fallbacks.get(family);
  }

  /**
   * Obtain a family not supplied up front: cache first, then Google Fonts.
   *
   * Returns an empty list when the family cannot be found, and remembers that so
   * a run converting two hundred files does not attempt two hundred lookups for
   * the same missing family.
   */
  async acquire(family: string): Promise<FontPayload[]> {
    const existing = this.#payloads.get(family);
    if (existing) return existing;
    if (this.#attempted.has(family)) return [];
    this.#attempted.add(family);

    const cached = readCached(family, this.#env);
    if (cached.length > 0) return this.#store(family, cached);

    if (this.#noFetch) return [];

    const resolved = await resolveFamily(family, this.#fetch);
    if (!resolved) return [];

    writeCached(family, resolved.files, this.#env);
    return this.#store(family, resolved.files);
  }

  #store(family: string, files: { name: string; buffer: Buffer }[]): FontPayload[] {
    const payloads = files.map((f) => ({ family, base64: f.buffer.toString('base64') }));
    this.#payloads.set(family, payloads);
    return payloads;
  }

  async #addSpec(spec: string): Promise<void> {
    if (spec.startsWith('google:')) {
      const family = spec.slice('google:'.length).trim();
      if (!family) throw new Error(`--font google: requires a family name, got "${spec}"`);
      const got = await this.acquire(family);
      if (got.length === 0) {
        throw new Error(`--font google:${family} could not be resolved on Google Fonts`);
      }
      return;
    }

    // `Family=path`. Split on the first `=` so Windows paths keep their colons.
    const eq = spec.indexOf('=');
    if (eq > 0) {
      const family = spec.slice(0, eq).trim();
      const file = spec.slice(eq + 1).trim();
      if (!family || !file) throw new Error(`--font expects Family=path, got "${spec}"`);
      this.#addFile(file, family);
      return;
    }

    this.#addFile(spec, null);
  }

  #addFile(file: string, family: string | null): void {
    const ext = path.extname(file).toLowerCase();

    if (family === null && COMPRESSED.has(ext)) {
      throw new Error(
        `cannot read a family name from ${path.basename(file)}: ${ext} tables are compressed. ` +
          `Use --font "Family=${file}" instead.`,
      );
    }

    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch {
      throw new Error(`--font file not found: ${file}`);
    }

    const resolved = family ?? readFamilyName(buffer);
    if (!resolved) {
      throw new Error(
        `could not read a family name from ${path.basename(file)}. ` +
          `Use --font "Family=${file}" to name it explicitly.`,
      );
    }

    const list = this.#payloads.get(resolved) ?? [];
    list.push({ family: resolved, base64: buffer.toString('base64') });
    this.#payloads.set(resolved, list);
  }
}

function isFontFile(name: string): boolean {
  return ['.ttf', '.otf', '.ttc'].includes(path.extname(name).toLowerCase());
}

function parseFallbacks(specs: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const spec of specs) {
    const eq = spec.indexOf('=');
    if (eq <= 0 || eq === spec.length - 1) {
      throw new Error(`--font-fallback expects Requested=Available, got "${spec}"`);
    }
    map.set(spec.slice(0, eq).trim(), spec.slice(eq + 1).trim());
  }
  return map;
}
