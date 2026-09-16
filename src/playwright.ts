/**
 * Locating `playwright-core` at runtime.
 *
 * It cannot be bundled: `coreBundle.js` lazily requires `chromium-bidi`
 * submodules by path, and it resolves its own driver and browser registry
 * relative to its real location on disk. So it always ships as files beside the
 * executable, and this module finds them.
 *
 * A static `import` would also defeat a single-file build, where `require` only
 * resolves built-in modules. Everything here is deliberately lazy and typed via
 * `import type`, which erases at compile time.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserType } from 'playwright-core';

let cached: BrowserType | null = null;

/** Directories to search for a `node_modules/playwright-core`, nearest first. */
function searchRoots(): string[] {
  const roots: string[] = [];

  // Beside the executable: the portable build's layout.
  roots.push(path.dirname(process.execPath));

  // Beside this module, walking up: a normal checkout or an npm install.
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
      roots.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // `import.meta.url` is unavailable in a CommonJS build; the other roots cover it.
  }

  // Where a single-file build unpacks its dependencies.
  if (process.env.CRISPR_MODULES) roots.push(process.env.CRISPR_MODULES);

  return roots;
}

/**
 * Load Playwright's chromium namespace.
 *
 * Throws with the list of places searched, because "cannot find playwright-core"
 * without saying where it looked is not an error anybody can act on.
 */
export function chromium(): BrowserType {
  if (cached) return cached;

  const tried: string[] = [];

  // A plain resolve first: correct for a checkout and for `npm i -g crispr`.
  try {
    const req = createRequire(import.meta.url);
    cached = (req('playwright-core') as { chromium: BrowserType }).chromium;
    return cached;
  } catch {
    tried.push('the module resolution path');
  }

  for (const root of searchRoots()) {
    const entry = path.join(root, 'node_modules', 'playwright-core', 'package.json');
    if (!fs.existsSync(entry)) {
      tried.push(path.join(root, 'node_modules'));
      continue;
    }
    try {
      const req = createRequire(entry);
      cached = (req('playwright-core') as { chromium: BrowserType }).chromium;
      return cached;
    } catch (error) {
      tried.push(`${entry} (${(error as Error).message})`);
    }
  }

  throw new Error(
    ['could not load playwright-core. Looked in:', ...tried.map((t) => `  ${t}`)].join('\n'),
  );
}
