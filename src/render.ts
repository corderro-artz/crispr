/**
 * Rendering one SVG to one PNG.
 *
 * The sequence is: navigate, wait, register known fonts, measure, detect
 * substitution, repair it if possible, size, capture.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from './discover.ts';
import type { PageLease } from './browser.ts';
import type { FontRegistry } from './fonts/registry.ts';
import { computeSize, type SizeOptions } from './size.ts';
import {
  applyBackground,
  applySize,
  measureAndNormalize,
  registerFont,
  requestedFamilies,
  waitForReady,
} from './page.ts';

export interface RenderOptions extends SizeOptions {
  background?: string;
  /** Supplies fonts and decides whether missing ones may be fetched. */
  fonts: FontRegistry;
}

export interface Substitution {
  text: string;
  requested: string[];
  actual: string[];
}

export interface RenderResult {
  input: string;
  output: string;
  width: number;
  height: number;
  substitutions: Substitution[];
  /** Families fetched to repair this file. */
  fetched: string[];
}

/**
 * Generic families resolve to whatever the platform picks, by design. Treating
 * them as substitutions would flag every well-formed SVG that ends its stack
 * with `sans-serif`.
 */
const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

export async function renderOne(lease: PageLease, job: Job, opts: RenderOptions): Promise<RenderResult> {
  const { page, cdp } = lease;

  await page.goto(pathToFileURL(job.input).href, { waitUntil: 'load' });
  await page.evaluate(waitForReady);

  // Navigation replaces the document, and `document.fonts` with it, so whatever
  // this page carried for the previous file is gone. Anything the registry has
  // learned since — including families fetched to repair an earlier file — is
  // re-registered here, which is what stops the same fetch happening twice.
  lease.registered.clear();
  await ensureRegistered(lease, opts.fonts.payloads());

  const intrinsic = await page.evaluate(measureAndNormalize);
  if (!(intrinsic.width > 0) || !(intrinsic.height > 0)) {
    throw new Error('SVG has no resolvable dimensions (width, height and viewBox are all absent or zero)');
  }

  const fetched: string[] = [];
  let substitutions = await detectSubstitutions(lease);

  if (substitutions.length > 0) {
    const repaired = await repair(lease, substitutions, opts);
    fetched.push(...repaired);
    if (repaired.length > 0) {
      await page.evaluate(waitForReady);
      substitutions = await detectSubstitutions(lease);
    }
  }

  const size = computeSize(intrinsic, opts);

  await page.setViewportSize(size);
  await page.evaluate(applySize, size);
  if (opts.background) await page.evaluate(applyBackground, opts.background);

  fs.mkdirSync(path.dirname(job.output), { recursive: true });
  await page.screenshot({
    path: job.output,
    type: 'png',
    omitBackground: !opts.background,
    clip: { x: 0, y: 0, ...size },
  });

  return { input: job.input, output: job.output, ...size, substitutions, fetched };
}

/** Register any payloads this page has not seen. Fonts persist across navigations. */
async function ensureRegistered(lease: PageLease, payloads: { family: string; base64: string }[]): Promise<void> {
  for (const payload of payloads) {
    await lease.page.evaluate(registerFont, payload);
    lease.registered.add(payload.family);
  }
}

/**
 * Compare what each text node asked for against what Chromium actually used.
 *
 * `document.fonts.check()` cannot do this: it returns true for families that do
 * not exist. `CSS.getPlatformFontsForNode` reports the fonts actually
 * rasterised with, which is the only trustworthy source.
 *
 * What counts as satisfied is the **first** family in the stack, not any of
 * them. A stack like `Noto Sans JP, Yu Gothic, Meiryo, sans-serif` is a
 * preference order with fallbacks for machines that lack the real thing, and
 * landing on Yu Gothic is CSS behaving correctly but is still not the design.
 * Since crispr can go and fetch the preferred family, "correct per CSS" is too
 * low a bar — the whole point is to render what the author asked for.
 *
 * Per-glyph fallback stays legitimate: a node whose preferred family lacks CJK
 * coverage reports both that family and the CJK one, and seeing the preferred
 * family anywhere in the report is enough.
 */
async function detectSubstitutions(lease: PageLease): Promise<Substitution[]> {
  const requested = await lease.page.evaluate(requestedFamilies);
  if (requested.length === 0) return [];

  const { root } = await lease.cdp.send('DOM.getDocument', { depth: -1 });
  const nodeIds = collectTextNodeIds(root);

  const found: Substitution[] = [];

  for (const [index, entry] of requested.entries()) {
    const nodeId = nodeIds[index];
    if (nodeId === undefined) continue;
    if (!entry.text.trim()) continue;

    let actual: string[];
    try {
      const report = await lease.cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      actual = report.fonts.map((f) => f.familyName).filter(Boolean);
    } catch {
      // A node that cannot be queried is not evidence of a substitution.
      continue;
    }
    if (actual.length === 0) continue;

    const stack = entry.families.filter((f) => !GENERIC.has(f.toLowerCase()));
    const preferred = stack[0];
    if (preferred === undefined) continue;

    // A family we registered ourselves counts as satisfied even though CDP
    // reports the font file's own name rather than the alias it was registered
    // under. Supplying `--font "Noto Sans=Something.ttf"` is a deliberate
    // instruction, not a substitution to warn about.
    const satisfied =
      lease.registered.has(preferred) ||
      actual.some((used) => used.toLowerCase() === preferred.toLowerCase());

    if (!satisfied) found.push({ text: entry.text, requested: stack, actual });
  }

  return found;
}

/** Walk the CDP document for `text` and `tspan` nodes, in document order. */
function collectTextNodeIds(root: { nodeName?: string; nodeId?: number; children?: unknown[] }): number[] {
  const ids: number[] = [];
  const visit = (node: { nodeName?: string; nodeId?: number; children?: unknown[] }): void => {
    const name = node.nodeName?.toLowerCase();
    if ((name === 'text' || name === 'tspan') && node.nodeId !== undefined) ids.push(node.nodeId);
    for (const child of node.children ?? []) {
      visit(child as { nodeName?: string; nodeId?: number; children?: unknown[] });
    }
  };
  visit(root);
  return ids;
}

/**
 * Try to satisfy each substituted family, first through an explicit fallback
 * mapping and then through Google Fonts. Returns the families actually acquired.
 */
async function repair(
  lease: PageLease,
  substitutions: Substitution[],
  opts: RenderOptions,
): Promise<string[]> {
  // Only the preferred family is worth acquiring. Fetching the rest of the stack
  // would download the fallbacks the author listed precisely so that nothing
  // would need downloading.
  const wanted = new Set<string>();
  for (const sub of substitutions) {
    const preferred = sub.requested[0];
    if (preferred !== undefined) wanted.add(preferred);
  }

  const acquired: string[] = [];
  for (const family of wanted) {
    if (lease.registered.has(family)) continue;

    // acquire() applies any --font-fallback internally but keeps the requested
    // name on the payload, so the document's stack resolves either way.
    const payloads = await opts.fonts.acquire(family);
    if (payloads.length === 0) continue;

    for (const payload of payloads) {
      await lease.page.evaluate(registerFont, payload);
    }
    lease.registered.add(family);

    const target = opts.fonts.fallbackFor(family);
    acquired.push(target ? `${family} (via ${target})` : family);
  }

  return acquired;
}
