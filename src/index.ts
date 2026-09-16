/**
 * Entry point: wire discovery, the page pool, rendering and reporting together.
 */

import { discover } from './discover.ts';
import { browserCandidates, launch, PagePool } from './browser.ts';
import { FontRegistry } from './fonts/registry.ts';
import { renderOne, type RenderResult } from './render.ts';
import { fontReport, summarize, type Failure } from './report.ts';
import { parseCliArgs, VERSION } from './cli.ts';

export { VERSION };

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }

  if (parsed.kind === 'help') {
    process.stdout.write(parsed.text);
    return 0;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${parsed.text}\n`);
    return 0;
  }

  const opts = parsed.options;

  let jobs;
  let fonts;
  try {
    jobs = discover(opts.inputs, opts.out, opts.recursive);
    fonts = await FontRegistry.create({
      specs: opts.fontSpecs,
      dirs: opts.fontDirs,
      fallbacks: opts.fontFallbacks,
      // --list-fonts reports on what is there; it must not change it by
      // fetching, or the report would describe a state the user never had.
      noFetch: opts.noFontFetch || opts.listFonts,
    });
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }

  if (jobs.length === 0) {
    process.stderr.write('no .svg files found in the given paths\n');
    return 1;
  }

  let launched;
  try {
    launched = await launch(
      browserCandidates(opts.browserPath ? { browserPath: opts.browserPath } : {}),
    );
  } catch (error) {
    process.stderr.write(
      `${(error as Error).message}\n` +
        `Install one with "npx playwright install chromium --only-shell", ` +
        `or point crispr at one with --browser-path.\n`,
    );
    return 2;
  }
  const { browser, choice } = launched;
  if (opts.verbose) process.stderr.write(`browser: ${choice.source}\n`);

  const results: RenderResult[] = [];
  const failures: Failure[] = [];
  const pool = await PagePool.create(browser, Math.min(opts.jobs, jobs.length));

  try {
    await Promise.all(
      jobs.map((job) =>
        pool.run(async (lease) => {
          try {
            results.push(
              await renderOne(lease, job, {
                fonts,
                ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
                ...(opts.width !== undefined ? { width: opts.width } : {}),
                ...(opts.height !== undefined ? { height: opts.height } : {}),
                ...(opts.dpi !== undefined ? { dpi: opts.dpi } : {}),
                ...(opts.background !== undefined ? { background: opts.background } : {}),
              }),
            );
          } catch (error) {
            // One malformed file must never abort a batch.
            failures.push({ input: job.input, reason: (error as Error).message });
          }
        }),
      ),
    );
  } finally {
    await pool.close();
    await browser.close();
  }

  // Keep output order stable regardless of which page finished first.
  results.sort((a, b) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0));
  failures.sort((a, b) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0));

  if (opts.listFonts) {
    process.stdout.write(`${fontReport(results)}\n`);
    return failures.length > 0 ? 1 : 0;
  }

  const summary = summarize(results, failures, {
    strictFonts: opts.strictFonts,
    quiet: opts.quiet,
    verbose: opts.verbose,
    ...(choice.unpinned ? { unpinnedBrowser: choice.source } : {}),
  });

  if (summary.text) process.stderr.write(`${summary.text}\n`);
  return summary.exitCode;
}
