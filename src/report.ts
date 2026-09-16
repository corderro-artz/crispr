/**
 * Turning results into something a person, or a build, can act on.
 */

import path from 'node:path';
import type { RenderResult } from './render.ts';

export interface Failure {
  input: string;
  reason: string;
}

export interface SummaryOptions {
  strictFonts: boolean;
  quiet: boolean;
  verbose: boolean;
  /** Set when the browser's version is outside our control. */
  unpinnedBrowser?: string;
}

export interface Summary {
  text: string;
  exitCode: number;
}

/**
 * Build the end-of-run report.
 *
 * Substitutions are reported by default rather than behind a flag: a PNG in the
 * wrong typeface looks fine, so nothing else will ever tell you. Under
 * `--strict-fonts` they also fail the run, for pipelines where a
 * wrong-but-plausible image is worse than a broken build.
 */
export function summarize(
  results: RenderResult[],
  failures: Failure[],
  opts: SummaryOptions,
): Summary {
  const lines: string[] = [];

  const substituted = results.filter((r) => r.substitutions.length > 0);
  const fetched = new Set(results.flatMap((r) => r.fetched));

  if (opts.verbose) {
    for (const result of results) {
      lines.push(`  ${path.basename(result.input)} -> ${result.width}x${result.height}`);
    }
  }

  if (opts.unpinnedBrowser) {
    lines.push(
      `warning: using ${opts.unpinnedBrowser}, whose version is not pinned. ` +
        `Output may differ between machines.`,
    );
  }

  if (fetched.size > 0 && !opts.quiet) {
    lines.push(`fetched ${fetched.size} font ${plural(fetched.size, 'family', 'families')}: ${[...fetched].sort().join(', ')}`);
  }

  for (const result of substituted) {
    const label = opts.strictFonts ? 'error' : 'warning';
    lines.push(`${label}: ${path.basename(result.input)} rendered with substituted fonts`);
    for (const sub of result.substitutions) {
      const text = sub.text.length > 24 ? `${sub.text.slice(0, 24)}…` : sub.text;
      lines.push(`    "${text}" wanted ${sub.requested[0]}, got ${sub.actual.join(', ')}`);
    }
  }

  for (const failure of failures) {
    lines.push(`error: ${path.basename(failure.input)}: ${failure.reason}`);
  }

  const converted = results.length;
  if (!opts.quiet || failures.length > 0 || substituted.length > 0) {
    const parts = [`${converted} converted`];
    if (failures.length > 0) parts.push(`${failures.length} failed`);
    if (substituted.length > 0) parts.push(`${substituted.length} with substituted fonts`);
    lines.push(parts.join(', '));
  }

  const failed = failures.length > 0 || (opts.strictFonts && substituted.length > 0);
  return { text: lines.join('\n'), exitCode: failed ? 1 : 0 };
}

/** Report requested versus actual fonts without writing anything. */
export function fontReport(results: RenderResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(path.basename(result.input));
    if (result.substitutions.length === 0) {
      lines.push('    all preferred families resolved');
      continue;
    }
    for (const sub of result.substitutions) {
      const text = sub.text.length > 24 ? `${sub.text.slice(0, 24)}…` : sub.text;
      lines.push(`    "${text}"  wanted ${sub.requested.join(', ')}  got ${sub.actual.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
