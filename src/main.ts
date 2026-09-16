/**
 * The executable entry point.
 *
 * Kept separate from `index.ts` so that importing `main` in a test never starts
 * a run or calls `process.exit`.
 */

import { main } from './index.ts';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 2;
  },
);
