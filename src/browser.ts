/**
 * Finding a Chromium, launching it, and handing out pages.
 *
 * One chain serves every release shape: the portable build finds a browser
 * beside the executable, the thin build finds one in the cache, and a developer
 * checkout finds Playwright's own install.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { cacheDir } from './fonts/cache.ts';

export interface BrowserChoice {
  executablePath?: string;
  channel?: string;
  /** Which step of the chain won. Surfaced by `--verbose`, and drives the drift warning. */
  source: string;
  /** True when the browser's version is outside our control, so output may drift. */
  unpinned: boolean;
}

export interface ResolveOptions {
  browserPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Directory the executable lives in. Defaults to the real one. */
  execDir?: string;
}

/** Candidate executable names inside a browsers directory, newest naming first. */
const SHELL_NAMES = ['chrome-headless-shell.exe', 'headless_shell.exe', 'chrome.exe', 'chrome-headless-shell', 'headless_shell', 'chrome'];

/**
 * Pick a browser.
 *
 * Order: explicit flag, environment, a `browsers/` folder beside the executable,
 * the font/browser cache, Playwright's own install, then a system branded
 * browser. Only the last is unpinned, because branded Chrome and Edge update
 * themselves and their headless mode differs from the headless shell.
 */
export function resolveBrowser(opts: ResolveOptions = {}): BrowserChoice {
  const env = opts.env ?? process.env;
  const execDir = opts.execDir ?? path.dirname(process.execPath);

  if (opts.browserPath) {
    if (!fs.existsSync(opts.browserPath)) {
      throw new Error(`--browser-path does not exist: ${opts.browserPath}`);
    }
    return { executablePath: opts.browserPath, source: '--browser-path', unpinned: false };
  }

  const fromEnv = env.CRISPR_BROWSER;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`CRISPR_BROWSER does not exist: ${fromEnv}`);
    }
    return { executablePath: fromEnv, source: 'CRISPR_BROWSER', unpinned: false };
  }

  const beside = findShell(path.join(execDir, 'browsers'));
  if (beside) return { executablePath: beside, source: 'bundled', unpinned: false };

  const cached = findShell(path.join(path.dirname(cacheDir(env)), 'browsers'));
  if (cached) return { executablePath: cached, source: 'cache', unpinned: false };

  // Playwright resolves its own download when neither path nor channel is given.
  if (playwrightHasBrowser()) {
    return { source: 'playwright', unpinned: false };
  }

  return { channel: 'msedge', source: 'system msedge', unpinned: true };
}

/** Whether Playwright's own browser download is present and launchable. */
function playwrightHasBrowser(): boolean {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** Search a browsers directory for a Chromium executable, at any depth. */
function findShell(root: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const name of SHELL_NAMES) {
    const direct = path.join(root, name);
    if (fs.existsSync(direct)) return direct;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = findShell(path.join(root, entry.name));
    if (nested) return nested;
  }
  return null;
}

/** A page plus the CDP session and font bookkeeping that travel with it. */
export interface PageLease {
  page: Page;
  cdp: CDPSession;
  /** Families already registered on this page, so injection happens once per page. */
  registered: Set<string>;
}

/**
 * A fixed set of pages over one context.
 *
 * One context is enough because sizing never touches `deviceScaleFactor` — it
 * rewrites the SVG instead — so no per-file context configuration exists.
 * Creating a context is the expensive part of Playwright; creating a page is not.
 */
export class PagePool {
  readonly #leases: PageLease[];
  readonly #idle: PageLease[];
  readonly #waiting: ((lease: PageLease) => void)[] = [];
  readonly #context: BrowserContext;

  private constructor(context: BrowserContext, leases: PageLease[]) {
    this.#context = context;
    this.#leases = leases;
    this.#idle = [...leases];
  }

  static async create(browser: Browser, size: number): Promise<PagePool> {
    const context = await browser.newContext({ viewport: { width: 64, height: 64 } });
    const leases: PageLease[] = [];

    for (let i = 0; i < Math.max(1, size); i++) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      leases.push({ page, cdp, registered: new Set() });
    }

    return new PagePool(context, leases);
  }

  get size(): number {
    return this.#leases.length;
  }

  /** Borrow a page for the duration of `fn`, returning it even if `fn` throws. */
  async run<T>(fn: (lease: PageLease) => Promise<T>): Promise<T> {
    const lease = this.#idle.pop() ?? (await new Promise<PageLease>((r) => this.#waiting.push(r)));
    try {
      return await fn(lease);
    } finally {
      const next = this.#waiting.shift();
      if (next) next(lease);
      else this.#idle.push(lease);
    }
  }

  async close(): Promise<void> {
    await this.#context.close();
  }
}

/** Launch a browser using a resolved choice. */
export async function launch(choice: BrowserChoice): Promise<Browser> {
  return chromium.launch({
    headless: true,
    ...(choice.executablePath ? { executablePath: choice.executablePath } : {}),
    ...(choice.channel ? { channel: choice.channel } : {}),
  });
}
