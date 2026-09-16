/**
 * On-disk cache for downloaded fonts.
 *
 * This is the reproducibility boundary. Automatic fetching makes a first run
 * depend on network state; a populated cache plus `--no-font-fetch` makes every
 * later run independent of it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { familySlug } from './google.ts';

/**
 * Where downloaded fonts live. `%LOCALAPPDATA%\crispr\fonts` on Windows, and
 * the XDG-ish equivalent elsewhere, so the cache survives moving the executable.
 */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CRISPR_CACHE_DIR;
  if (override) return path.resolve(override);

  const base =
    env.LOCALAPPDATA ??
    env.XDG_CACHE_HOME ??
    path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache');

  return path.join(base, 'crispr', 'fonts');
}

/** Where a single downloaded file for a family lands. */
export function cachedPath(family: string, file: string, env?: NodeJS.ProcessEnv): string {
  return path.join(cacheDir(env), familySlug(family), file);
}

/** Every cached file for a family, or an empty list when nothing is cached. */
export function readCached(family: string, env?: NodeJS.ProcessEnv): { name: string; buffer: Buffer }[] {
  const dir = path.dirname(cachedPath(family, 'x', env));
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return [];
  }

  const files: { name: string; buffer: Buffer }[] = [];
  for (const name of names) {
    try {
      files.push({ name, buffer: fs.readFileSync(path.join(dir, name)) });
    } catch {
      // A file that vanished between listing and reading is simply not cached.
    }
  }
  return files;
}

/** Persist downloaded files for a family. Failure to cache is never fatal. */
export function writeCached(
  family: string,
  files: { name: string; buffer: Buffer }[],
  env?: NodeJS.ProcessEnv,
): void {
  for (const file of files) {
    const target = cachedPath(family, file.name, env);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.buffer);
    } catch {
      // A read-only or full cache directory degrades to re-downloading, which is
      // slower but still correct. Never fail a render over it.
    }
  }
}
