/**
 * Argument parsing and help text.
 *
 * Everything here runs before a browser is launched, so a usage mistake costs a
 * message rather than a browser startup.
 */

import { parseArgs } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { validateSizeOptions, type SizeOptions } from './size.ts';

export const VERSION = '0.1.0';

export interface Options extends SizeOptions {
  inputs: string[];
  out: string;
  recursive: boolean;
  background?: string;
  fontSpecs: string[];
  fontDirs: string[];
  fontFallbacks: string[];
  noFontFetch: boolean;
  strictFonts: boolean;
  listFonts: boolean;
  jobs: number;
  browserPath?: string;
  quiet: boolean;
  verbose: boolean;
}

export type ParseResult =
  | { kind: 'run'; options: Options }
  | { kind: 'help'; text: string }
  | { kind: 'version'; text: string };

/** Upper bound on `--jobs`. Beyond this, pages cost more than they save. */
const MAX_JOBS = 64;

export function helpText(): string {
  return `crispr ${VERSION} — lossless SVG to PNG through headless Chromium

Usage
  crispr <path...> [options]

Paths may be files or directories, mixed freely. Only .svg files are converted;
anything else is ignored.

Output
  -o, --out <dir>           output directory (default: crispr-out beside the executable)
  -r, --recursive           recurse into subdirectories, mirroring the tree

Size  (default: the SVG's own dimensions, 1 SVG pixel to 1 PNG pixel)
  -s, --scale <n>           multiply the intrinsic size
  -w, --width <px>          pin the width; height follows the aspect ratio
  -H, --height <px>         pin the height; width follows the aspect ratio
      --dpi <n>             equivalent to --scale n/96

Appearance
  -b, --background <css>    solid background colour (default: transparent)

Fonts
      --font <spec>         a font file, "Family=path", or "google:Family"
      --font-dir <dir>      register every font in a directory
      --font-fallback <s>   "Requested=Available" family remap
      --no-font-fetch       never download a missing font
      --strict-fonts        treat a font substitution as an error
      --list-fonts          report requested vs actual fonts, write no PNGs

Execution
  -j, --jobs <n>            concurrent pages (default: min(cpus, 8), max ${MAX_JOBS})
      --browser-path <p>    explicit Chromium executable
      --quiet               errors only
      --verbose             per-file detail
  -h, --help                this text
  -V, --version             version

Examples
  crispr logo.svg
  crispr assets/ -r -o dist/png --scale 2
  crispr icon.svg --width 512 --background "#07080b"
  crispr brand/ --font "google:Noto Sans JP" --strict-fonts
`;
}

/** Default output directory: beside the executable, as promised in the help text. */
export function defaultOutDir(execPath = process.execPath, argv1 = process.argv[1]): string {
  // Under `node dist/crispr.js` the executable is node itself, so the script
  // location is the honest answer. A packaged build has no meaningful argv[1].
  const base = path.basename(execPath).toLowerCase().startsWith('node') && argv1
    ? path.dirname(argv1)
    : path.dirname(execPath);
  return path.join(base, 'crispr-out');
}

export function parseCliArgs(argv: string[]): ParseResult {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTION_CONFIG; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_CONFIG, allowPositionals: true, strict: true });
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\nRun "crispr --help" for usage.`);
  }

  const values = parsed.values;

  if (values.help) return { kind: 'help', text: helpText() };
  if (values.version) return { kind: 'version', text: VERSION };

  const inputs = parsed.positionals;
  if (inputs.length === 0) {
    throw new Error('no input paths given\n\nRun "crispr --help" for usage.');
  }

  const size: SizeOptions = {
    ...(values.scale !== undefined ? { scale: num('--scale', values.scale) } : {}),
    ...(values.width !== undefined ? { width: num('--width', values.width) } : {}),
    ...(values.height !== undefined ? { height: num('--height', values.height) } : {}),
    ...(values.dpi !== undefined ? { dpi: num('--dpi', values.dpi) } : {}),
  };
  validateSizeOptions(size);

  const jobs = values.jobs === undefined ? defaultJobs() : num('--jobs', values.jobs);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_JOBS) {
    throw new Error(`--jobs must be a whole number between 1 and ${MAX_JOBS}, got ${values.jobs}`);
  }

  if (values.quiet && values.verbose) {
    throw new Error('--quiet cannot be combined with --verbose');
  }

  return {
    kind: 'run',
    options: {
      ...size,
      inputs,
      out: values.out ?? defaultOutDir(),
      recursive: values.recursive ?? false,
      ...(values.background !== undefined ? { background: values.background } : {}),
      fontSpecs: values.font ?? [],
      fontDirs: values['font-dir'] ?? [],
      fontFallbacks: values['font-fallback'] ?? [],
      noFontFetch: values['no-font-fetch'] ?? false,
      strictFonts: values['strict-fonts'] ?? false,
      listFonts: values['list-fonts'] ?? false,
      jobs,
      ...(values['browser-path'] !== undefined ? { browserPath: values['browser-path'] } : {}),
      quiet: values.quiet ?? false,
      verbose: values.verbose ?? false,
    },
  };
}

/** One page per core is wasteful past a point; eight saturates a typical machine. */
function defaultJobs(): number {
  return Math.max(1, Math.min(os.cpus().length || 1, 8));
}

function num(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${flag} expects a number, got "${raw}"`);
  return value;
}

const OPTION_CONFIG = {
  out: { type: 'string', short: 'o' },
  recursive: { type: 'boolean', short: 'r' },
  scale: { type: 'string', short: 's' },
  width: { type: 'string', short: 'w' },
  // -H, because -h is help. Losing help to height would be a worse trade.
  height: { type: 'string', short: 'H' },
  dpi: { type: 'string' },
  background: { type: 'string', short: 'b' },
  font: { type: 'string', multiple: true },
  'font-dir': { type: 'string', multiple: true },
  'font-fallback': { type: 'string', multiple: true },
  'no-font-fetch': { type: 'boolean' },
  'strict-fonts': { type: 'boolean' },
  'list-fonts': { type: 'boolean' },
  jobs: { type: 'string', short: 'j' },
  'browser-path': { type: 'string' },
  quiet: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
} as const;
