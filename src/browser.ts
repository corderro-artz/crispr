/**
 * Finding a Chromium, launching it, and handing out pages.
 *
 * One chain serves every release shape: the portable build finds a browser
 * beside the executable, the thin build finds one in the cache, and a developer
 * checkout finds Playwright's own install.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';
import { chromium } from './playwright.ts';
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
 * Rank the browsers worth trying, best first.
 *
 * A list rather than a single answer because availability cannot be settled by
 * inspection. `chromium.executablePath()` names the full Chromium build, which
 * is absent whenever the browser was installed with `--only-shell` — so probing
 * that path reports "no Playwright browser" on a perfectly good install. Letting
 * launch try each candidate in turn is the only honest test, and it also covers
 * a bundled browser that exists but will not start.
 *
 * Order: explicit flag, environment, a `browsers/` folder beside the executable,
 * the cache, Playwright's own install, then a system branded browser. Only the
 * last is unpinned, because branded Chrome and Edge update themselves and their
 * headless mode differs from the headless shell.
 */
export function browserCandidates(opts: ResolveOptions = {}): BrowserChoice[] {
  const env = opts.env ?? process.env;
  const execDir = opts.execDir ?? path.dirname(process.execPath);

  // An explicit choice is the only candidate: silently falling back to a
  // different browser than the one named would defeat the point of naming it.
  if (opts.browserPath) {
    if (!fs.existsSync(opts.browserPath)) {
      throw new Error(`--browser-path does not exist: ${opts.browserPath}`);
    }
    return [{ executablePath: opts.browserPath, source: '--browser-path', unpinned: false }];
  }

  const fromEnv = env.CRISPR_BROWSER;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`CRISPR_BROWSER does not exist: ${fromEnv}`);
    }
    return [{ executablePath: fromEnv, source: 'CRISPR_BROWSER', unpinned: false }];
  }

  const candidates: BrowserChoice[] = [];

  const beside = findShell(path.join(execDir, 'browsers'));
  if (beside) candidates.push({ executablePath: beside, source: 'bundled', unpinned: false });

  const cached = findShell(path.join(path.dirname(cacheDir(env)), 'browsers'));
  if (cached) candidates.push({ executablePath: cached, source: 'cache', unpinned: false });

  // Playwright picks its own download, preferring the headless shell, when
  // neither an executable path nor a channel is given.
  candidates.push({ source: 'playwright', unpinned: false });

  candidates.push({ channel: 'msedge', source: 'system msedge', unpinned: true });
  candidates.push({ channel: 'chrome', source: 'system chrome', unpinned: true });

  return candidates;
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

/** Launch one specific candidate. */
export async function launchChoice(choice: BrowserChoice): Promise<Browser> {
  return chromium().launch({
    headless: true,
    ...(choice.executablePath ? { executablePath: choice.executablePath } : {}),
    ...(choice.channel ? { channel: choice.channel } : {}),
  });
}

/**
 * Launch the first candidate that starts, reporting which one won.
 *
 * Every failure is kept so that, when none work, the error names everything
 * that was tried rather than only the last thing.
 */
export async function launch(
  candidates: BrowserChoice[],
): Promise<{ browser: Browser; choice: BrowserChoice }> {
  const failures: string[] = [];

  for (const choice of candidates) {
    try {
      return { browser: await launchChoice(choice), choice };
    } catch (error) {
      const firstLine = (error as Error).message.split(/\r?\n/)[0] ?? 'failed to launch';
      failures.push(`  ${choice.source}: ${firstLine}`);
    }
  }

  throw new Error(['no usable browser found. Tried:', ...failures].join('\n'));
}
