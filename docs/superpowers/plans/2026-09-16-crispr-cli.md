# crispr CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that rasterizes SVG files to PNG through headless Chromium, at exact pixel dimensions, with missing fonts detected and resolved rather than silently substituted.

**Architecture:** One browser, one context, a pool of reused pages. Each file is loaded by navigating directly to its `file://` URL so relative references resolve. Size is applied by rewriting the SVG's `viewBox`/`width`/`height` rather than via `deviceScaleFactor`, keeping output dimensions integral and the context count at one. Font substitution is detected over CDP and repaired by fetching the family from Google Fonts.

**Tech Stack:** TypeScript, `playwright-core`, `node:test`, esbuild, Node SEA.

## Global Constraints

- Runtime dependency is `playwright-core` only. Dev dependencies are `typescript`, `esbuild`, `@types/node`.
- Node 22+ (SEA and `node:test` features). Target `ES2023`, module `nodenext`.
- All source is ESM. No CommonJS.
- Every module gets tests. Pure modules get unit tests; browser-dependent modules get integration tests against fixtures in `tests/fixtures/`.
- No network access in unit tests. Google Fonts resolution is tested against an injected fetch function.
- Chromium texture limit is 16384 px per side. Never emit a larger image; error instead.
- Existing fixtures live at `tests/fixtures/brand/` — `akira-icon.svg`, `vaporsoft-logo.svg`, `vaporsoft-banner.svg`, `vaporsoft-favicon.svg`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/size.ts` | Pure sizing math: intrinsic size + options to target dimensions |
| `src/discover.ts` | Input paths to `{input, output}` pairs; recursion, mirroring |
| `src/fonts/name-table.ts` | Parse family name from an sfnt `name` table |
| `src/fonts/google.ts` | Resolve and download a family from `google/fonts` |
| `src/fonts/cache.ts` | On-disk font cache under `%LOCALAPPDATA%\crispr\fonts` |
| `src/fonts/registry.ts` | Collect fonts from flags; hand base64 payloads to pages |
| `src/browser.ts` | Browser resolution chain, launch, page pool |
| `src/page.ts` | In-page functions: normalize, measure, resize, register fonts |
| `src/render.ts` | Render one SVG to one PNG, including font repair |
| `src/report.ts` | Result accumulation, summary text, exit code |
| `src/cli.ts` | `parseArgs` wiring, validation, help text |
| `src/index.ts` | Entry point; wires discovery, pool, reporting |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/index.ts`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` runs `node --test`, `npm run build` emits `dist/crispr.js`.

- [ ] **Step 1:** Write `package.json` with `"type": "module"`, scripts `test`, `build`, `typecheck`.
- [ ] **Step 2:** Write `tsconfig.json` targeting `ES2023`, `nodenext`, `strict: true`, `outDir: dist`.
- [ ] **Step 3:** Write a smoke test asserting the version export.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 2: `src/size.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Intrinsic { width: number; height: number }
  export interface SizeOptions { scale?: number; width?: number; height?: number; dpi?: number }
  export const MAX_DIMENSION = 16384;
  export function computeSize(intrinsic: Intrinsic, opts: SizeOptions): { width: number; height: number }
  export function validateSizeOptions(opts: SizeOptions): void  // throws on conflicts
  ```

Rules, restated so they are testable:

| Input | Output |
|---|---|
| `{}` | intrinsic, rounded |
| `{scale: 2}` | intrinsic × 2 |
| `{dpi: 192}` | intrinsic × 2 |
| `{width: 800}` on 100×50 | 800×400 |
| `{height: 400}` on 100×50 | 800×400 |
| `{width: 800, height: 100}` | 800×100 exactly |
| `{scale: 2, width: 800}` | throws |
| result > 16384 per side | throws naming the computed size |

Rounding is `Math.round`, applied once at the end.

- [ ] **Step 1:** Write failing tests covering every row above plus zero/negative rejection.
- [ ] **Step 2:** Run tests. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `computeSize` and `validateSizeOptions`.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 3: `src/discover.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Job { input: string; output: string }
  export function discover(inputs: string[], outDir: string, recursive: boolean): Job[]
  ```

Behaviour: a file input contributes itself if it ends `.svg` (case-insensitive). A directory contributes its `.svg` children, and with `recursive` its whole subtree with structure mirrored under `outDir`. Non-SVG files are skipped silently. A missing path throws naming it. Output paths swap the extension to `.png`.

- [ ] **Step 1:** Write failing tests using a temp tree: flat dir, nested dir with and without `recursive`, mixed extensions, single file, missing path, uppercase `.SVG`.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 4: `src/fonts/name-table.ts`

**Interfaces:**
- Produces: `export function readFamilyName(buf: Buffer): string | null`

Parses the sfnt table directory, locates `name`, walks its records, prefers nameID 16 (typographic family) and falls back to nameID 1. Platform 3 (Windows) and 0 (Unicode) records are UTF-16BE; platform 1 (Mac) is Latin-1. Returns `null` when the buffer is not sfnt or has no `name` table.

- [ ] **Step 1:** Write failing tests against `tests/fixtures/fonts/` — a real TTF expecting its exact family, plus a truncated buffer expecting `null`.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 5: `src/fonts/google.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; buffer(): Promise<Buffer>; text(): Promise<string> }>
  export function familySlug(family: string): string
  export function parseMetadata(pb: string): string[]          // filenames, in listed order
  export function pickFiles(filenames: string[]): string[]     // variable font if present, else Regular
  export async function resolveFamily(family: string, fetch: Fetcher): Promise<{ license: string; files: { name: string; buffer: Buffer }[] } | null>
  ```

`familySlug` lowercases and strips spaces. `resolveFamily` tries `ofl`, `apache`, `ufl` in order against
`https://raw.githubusercontent.com/google/fonts/main/<license>/<slug>/METADATA.pb`, returning `null` when all three 404.

`pickFiles` prefers a filename containing `[` (a variable font, covering all weights); otherwise it takes `-Regular`, and `-Bold`/`-Medium`/`-Light` when present. Italic files are excluded.

- [ ] **Step 1:** Write failing tests with a stub `Fetcher`: `ofl` hit, `apache` fallback (Syncopate's real case), all-404 returning `null`, variable-vs-static `pickFiles`, `familySlug` over `"Noto Sans JP"` and `"Zen Kaku Gothic New"`.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 6: `src/fonts/cache.ts` and `src/fonts/registry.ts`

**Interfaces:**
- Consumes: `readFamilyName`, `resolveFamily`
- Produces:
  ```ts
  export function cacheDir(): string
  export function cachedPath(family: string, file: string): string
  export interface FontPayload { family: string; base64: string }
  export class FontRegistry {
    static fromFlags(specs: string[], dirs: string[], fetch?: Fetcher): Promise<FontRegistry>
    payloads(): FontPayload[]
    has(family: string): boolean
    acquire(family: string): Promise<FontPayload | null>   // cache, then Google
  }
  ```

`--font` spec forms: a bare path (family from the `name` table), `Family=path`, and `google:Family`. A bare `.woff`/`.woff2` path is a usage error naming the `Family=path` form, since the name table is Brotli-compressed.

- [ ] **Step 1:** Write failing tests: each spec form, the woff2 usage error, cache hit avoiding the fetcher, cache miss populating the cache dir.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 7: `src/browser.ts`

**Interfaces:**
- Produces:
  ```ts
  export function resolveBrowser(opts: { browserPath?: string; env?: NodeJS.ProcessEnv }): Promise<{ executablePath?: string; channel?: string; source: string }>
  export class PagePool {
    static create(browser: Browser, size: number): Promise<PagePool>
    run<T>(fn: (lease: PageLease) => Promise<T>): Promise<T>
    close(): Promise<void>
  }
  export interface PageLease { page: Page; cdp: CDPSession; registered: Set<string> }
  ```

Resolution order: `browserPath`, `CRISPR_BROWSER`, `browsers/` beside the executable, the cache dir, Playwright's own install, then system `msedge`/`chrome`. `source` names which one won, for `--verbose` and for the drift warning on the system-browser branch.

`registered` tracks which families a given page already has, so fonts are injected once per page rather than once per file.

- [ ] **Step 1:** Write failing tests for `resolveBrowser` precedence using a temp dir and a stubbed env. Pool tests assert that `size` pages are created and that `run` serializes beyond capacity.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 8: `src/page.ts`

**Interfaces:**
- Produces, all designed to be `page.evaluate`d:
  ```ts
  export function measureAndNormalize(): { width: number; height: number }
  export function applySize(w: number, h: number): void
  export function registerFont(p: { family: string; base64: string }): Promise<void>
  export function requestedFamilies(): { nodeIndex: number; families: string[] }[]
  ```

`measureAndNormalize` resolves intrinsic size in the order: explicit non-percentage `width`/`height` via `getBoundingClientRect` (so the browser does unit conversion), then `viewBox`, then the bounding rect. It then guarantees a `viewBox`.

> The bounding rect must not come first. A standalone SVG with only a `viewBox` defaults to 100%×100% and reports the viewport — 1280×720 — not its own size.

- [ ] **Step 1:** Write failing integration tests rendering fixtures and asserting measured size: `akira-icon.svg` → 256×256, `vaporsoft-banner.svg` → 1000×200, plus generated fixtures with no `viewBox`, with `mm` units, and with percentage dimensions.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 9: `src/render.ts`

**Interfaces:**
- Consumes: `computeSize`, `PageLease`, `FontRegistry`
- Produces:
  ```ts
  export interface RenderResult { input: string; output: string; width: number; height: number; substitutions: string[]; fetched: string[] }
  export function renderOne(lease: PageLease, job: Job, opts: RenderOptions): Promise<RenderResult>
  ```

Sequence: goto → wait (`load`, `document.fonts.ready`, `<image>` decode) → register known fonts → measure/normalize → detect substitutions over CDP → if any and fetching is enabled, acquire and register, then re-detect → compute size → set viewport → apply size → screenshot.

Substitution detection compares `CSS.getPlatformFontsForNode` families against the node's requested stack. A node is flagged only when **no** reported family appears in its stack, so legitimate per-glyph fallback (a Latin font yielding to a CJK font) is not flagged.

- [ ] **Step 1:** Write failing integration tests: `vaporsoft-favicon.svg` (no text) renders with zero substitutions; `akira-icon.svg` with no fonts supplied reports a substitution; the same with Noto supplied reports none; output PNG dimensions match `computeSize`.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 10: `src/cli.ts` and `src/report.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Options { inputs: string[]; out: string; recursive: boolean; /* …sizing, fonts, jobs… */ }
  export function parseCliArgs(argv: string[]): Options | { help: string } | { version: string }
  export function helpText(): string
  export function summarize(results: RenderResult[], failures: Failure[]): { text: string; exitCode: number }
  ```

Validation runs before any browser launches: conflicting sizing flags, unknown flags, malformed `Family=path`, and `--jobs` outside 1..64 all fail with usage text.

- [ ] **Step 1:** Write failing tests: each flag parsed, short/long equivalence, `-H` is height and `-h` is help, sizing conflicts rejected, exit code 1 when any failure is present and 0 otherwise.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 11: `src/index.ts` end-to-end

- [ ] **Step 1:** Write a failing end-to-end test invoking the built CLI against `tests/fixtures/brand/` into a temp dir, asserting 4 PNGs with expected dimensions and exit code 0.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement orchestration: discover, launch, pool, render, report.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

---

### Task 12: Packaging and README

- [ ] **Step 1:** esbuild bundle to `dist/crispr.js`, then Node SEA to `crispr.exe`.
- [ ] **Step 2:** Build the four release shapes: Portable, Single file, Single file thin, Node-dependent.
- [ ] **Step 3:** Write `README.md` in the house style of the akira/kata/nfty READMEs.
- [ ] **Step 4:** Commit.

---

## Self-Review

**Spec coverage.** Sizing → Task 2. Discovery → Task 3. Fonts (detection, supply, fetch, cache) → Tasks 4–6, 9. Browser chain and pool → Task 7. Rendering approach → Tasks 8–9. CLI surface and error handling → Task 10. Packaging → Task 12.

**Type consistency.** `Job` is produced by Task 3 and consumed by Task 9. `FontPayload` is produced by Task 6 and consumed by Tasks 8–9. `RenderResult` is produced by Task 9 and consumed by Task 10. `PageLease` is produced by Task 7 and consumed by Tasks 8–9.
