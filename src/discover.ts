/**
 * Turning input paths into work. Kept free of browser dependencies so the
 * traversal and mirroring rules are testable against a plain temp tree.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Job {
  /** Absolute path to the source SVG. */
  input: string;
  /** Absolute path the PNG will be written to. */
  output: string;
}

function isSvg(name: string): boolean {
  return path.extname(name).toLowerCase() === '.svg';
}

function toOutput(outDir: string, relative: string): string {
  const parsed = path.parse(relative);
  return path.join(outDir, parsed.dir, `${parsed.name}.png`);
}

/**
 * Expand inputs into render jobs.
 *
 * A file contributes itself when it is an SVG. A directory contributes its SVG
 * children, and under `recursive` its whole subtree with the structure mirrored
 * beneath `outDir`.
 *
 * Non-SVG files are skipped without comment: pointing the tool at a mixed asset
 * folder is the normal case, not a mistake worth warning about. A path that does
 * not exist is a mistake, and throws.
 *
 * Results are sorted and de-duplicated so a given invocation always produces the
 * same work in the same order.
 */
export function discover(inputs: string[], outDir: string, recursive: boolean): Job[] {
  const jobs = new Map<string, Job>();
  const absOut = path.resolve(outDir);

  for (const raw of inputs) {
    const input = path.resolve(raw);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(input);
    } catch {
      throw new Error(`input path does not exist: ${input}`);
    }

    if (stat.isFile()) {
      if (isSvg(input)) {
        jobs.set(input, { input, output: toOutput(absOut, path.basename(input)) });
      }
      continue;
    }

    for (const relative of walk(input, recursive)) {
      const full = path.join(input, relative);
      jobs.set(full, { input: full, output: toOutput(absOut, relative) });
    }
  }

  return [...jobs.values()].sort((a, b) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0));
}

/** Relative paths of every SVG under `dir`, descending only when asked to. */
function walk(dir: string, recursive: boolean): string[] {
  const found: string[] = [];

  const visit = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (recursive) visit(path.join(current, entry.name), relative);
      } else if (entry.isFile() && isSvg(entry.name)) {
        found.push(relative);
      }
    }
  };

  visit(dir, '');
  return found;
}
