# crispr — SVG to PNG rasterizer

**Date:** 2026-09-16
**Status:** Approved design

## Purpose

A CLI that converts SVG files to PNG at any resolution, using headless Chromium
via Playwright so the output matches what a real browser engine draws — including
text shaping, font hinting, filters, gradients, clip paths, and blend modes that
standalone SVG rasterizers get wrong.

Input is one file or a folder. Output is a folder. Non-SVG files are ignored.

## Success criteria

1. A PNG's pixel dimensions are exactly what the sizing rules specify — no
   off-by-one from fractional scaling.
2. Rendering matches Chromium's own rendering of the same file, including
   externally referenced fonts and images that sit next to the SVG.
3. Backgrounds are transparent by default, so PNGs composite correctly.
4. One malformed file never aborts a batch.
5. Ships as a single Windows executable with no prerequisites.

## Non-goals

Other output formats, SVG optimization or minification, watch mode, animation
capture, and a GUI. These are separate projects if they are ever wanted.

## Architecture

### Rendering approach

Three decisions define the core, each chosen over a more obvious alternative.

**Navigate to the SVG file directly.** `page.goto('file:///…/logo.svg')` loads the
SVG as a standalone document, where `document.documentElement` is the `<svg>`
element itself. The alternative — reading the file and injecting it into a wrapper
HTML page via `setContent` — silently breaks anything the SVG references by
relative path: `<image href="./texture.png">`, `@font-face` pointing at a local
`.woff2`, and XML entity declarations. Direct navigation gives the document its
real base URL, so all of those resolve. It also removes the wrapper HTML, the file
read, and the `setContent` round trip.

**Scale by rewriting the SVG, not by `deviceScaleFactor`.** Before capture, an
in-page script guarantees the element has a `viewBox` (synthesizing one from the
intrinsic width and height when absent), then sets `width` and `height` to the
exact target pixel count. Chromium re-rasterizes the vectors at that size.

This matters for two reasons. Output dimensions become exact integers, where a
fractional `deviceScaleFactor` such as `800/331` would round unpredictably. And
because `deviceScaleFactor` stays at 1 for every file regardless of requested
size, the whole run shares **one browser context** — context creation is the
expensive part of Playwright, and this removes it from the per-file path entirely.

The `viewBox` synthesis is load-bearing. An SVG with `width="100" height="50"` and
no `viewBox` does not scale when you change its width and height — the attributes
define a canvas, not a transform, so the artwork stays at its original size in the
corner of a larger canvas. Synthesizing `viewBox="0 0 100 50"` makes subsequent
width and height changes scale the content uniformly.

**Replace `networkidle` with targeted waits.** `waitUntil: 'networkidle'` blocks
for 500 ms of network silence on every file, whether or not the file has any
external references. The replacement waits for `load`, then `document.fonts.ready`,
then `Promise.all` over `decode()` for each `<image>` element. Same correctness
guarantee — fonts and images are resolved before capture — without the fixed
half-second penalty per file.

### Sizing

Intrinsic size is resolved in order:

1. `width` and `height` attributes, with CSS units converted to pixels
2. `viewBox` width and height
3. `getBoundingClientRect()` on the rendered element

Flags then transform that intrinsic size:

| Flag | Output size |
|---|---|
| *(none)* | intrinsic |
| `--scale N` | intrinsic × N |
| `--dpi N` | intrinsic × N/96 |
| `--width W` | W wide, height from aspect ratio |
| `--height H` | H tall, width from aspect ratio |
| `--width W --height H` | exactly W × H; the SVG fits per its own `preserveAspectRatio` |

Precedence is width/height, then dpi, then scale. Combining `--scale` with
`--width` is a usage error rather than one silently winning.

Dimensions are clamped at 16384 px per side, Chromium's texture limit. Exceeding
it is an error naming the file and the computed size — past that limit Chromium
returns a truncated image rather than failing, so the check must happen in our
code.

### Command-line surface

```
crispr <path...> [options]

  -o, --out <dir>         output directory
  -r, --recursive         recurse into subdirectories, mirroring the tree
  -s, --scale <n>         multiply intrinsic size
  -w, --width <px>        pin output width
  -H, --height <px>       pin output height
      --dpi <n>           equivalent to --scale n/96
  -b, --background <css>  solid background colour; default transparent
      --font <spec>       font file, or Family=path; repeatable
      --font-dir <dir>    register every font in a directory
      --font-fallback <spec>  Requested=Available family remap; repeatable
      --strict-fonts      treat font substitution as an error
      --list-fonts        report requested vs actual fonts, write nothing
  -j, --jobs <n>          concurrent pages; default min(cpus, 8)
      --browser-path <p>  explicit Chromium executable
      --quiet             errors only
      --verbose           per-file timing
  -h, --help
  -V, --version
```

Multiple input paths are accepted, mixing files and folders freely. A folder
contributes its `.svg` files; without `--recursive` it contributes only its top
level. Files whose extension is not `.svg` are skipped without comment, since
pointing the tool at a mixed asset folder is the normal case rather than an error.

`--out` defaults to a `crispr-out` directory beside the executable — that is, next
to the `.exe` for packaged builds, and the current working directory otherwise.
The directory is created if missing. Existing PNGs are overwritten.

`-H` carries `--height` because `-h` is reserved for help.

### Fonts

An SVG that names a font the machine does not have still renders. Chromium
substitutes silently, producing a plausible but typographically wrong PNG. This
is the most dangerous failure mode in the tool, because nothing looks broken —
the output is simply not the design. Detection is therefore mandatory, not
optional, and substitution is reported by default rather than behind a flag.

**Detection.** `document.fonts.check()` cannot be used: it returns `true` for
families that do not exist, including invented ones. The reliable source is the
Chrome DevTools Protocol method `CSS.getPlatformFontsForNode`, which reports the
font Chromium actually rasterized with, per text node, with a glyph count. A
CDP session is opened once per page and reused. After layout, every `<text>` and
`<tspan>` node is queried and the reported family is compared against the
families named in that node's `font-family` list. Anything outside the list is a
substitution.

Per-glyph fallback is legitimate and must not be reported as an error: a Latin
font correctly yields to a CJK font for CJK glyphs, and `getPlatformFontsForNode`
reports both families for such a node. A node is only flagged when the font used
appears nowhere in its requested stack.

**Supplying fonts.** Fonts are registered at runtime by constructing a `FontFace`
from a base64 data URI and adding it to `document.fonts`. Data URIs are used
rather than `file://` URLs because a `file://` document cannot fetch sibling
`file://` resources without weakening Chromium's security flags. Registration
happens once per pooled page, not once per file, so the base64 cost is paid a
handful of times per run regardless of batch size.

| Flag | Behaviour |
|---|---|
| `--font <path>` | Register a font file. Family name is read from the font's internal `name` table. |
| `--font <Family>=<path>` | Register under an explicit family name. |
| `--font-dir <dir>` | Register every font file in a directory. |
| `--font-fallback <Requested>=<Available>` | Remap a missing family to an installed system family. |
| `--strict-fonts` | Treat any substitution as a per-file error. |
| `--list-fonts` | Report requested versus actual fonts for each file, then exit without writing PNGs. |

Family names are parsed from the sfnt `name` table, preferring nameID 16
(typographic family) and falling back to nameID 1. This works for `.ttf` and
`.otf`. WOFF and WOFF2 are compressed and their name table is not readable
without a decompressor, so those formats require the explicit `Family=path` form;
supplying a bare `.woff2` path is a usage error whose message names the required
form. Adding a Brotli decompressor to auto-derive WOFF2 family names is not worth
the dependency.

A system font that is already installed needs no flag — it resolves natively.
`--font-fallback` exists for the case where the correct font cannot be installed
and a deliberate substitute is better than an arbitrary one.

Default behaviour on substitution is a warning per affected file listing
requested and actual families. `--strict-fonts` promotes it to an error, for
build pipelines where a wrong-but-plausible PNG is worse than a failed build.

### Concurrency

One browser, one context, a pool of N reused pages draining a shared work queue.
Page reuse is what makes this cheap: creating a page is far less costly than
creating a context, and with `deviceScaleFactor` fixed at 1 there is no reason to
ever create a second context. Default `--jobs` is `min(cpus, 8)`; `-j 1` forces
serial execution.

### Browser resolution

One chain serves every release variant, checked in order:

1. `--browser-path`
2. `CRISPR_BROWSER` environment variable
3. `browsers/` directory beside the executable (portable build)
4. `%LOCALAPPDATA%\crispr\browsers` cache, downloading a pinned
   `chromium-headless-shell` if absent
5. Playwright's own browser installation
6. System Microsoft Edge or Google Chrome

Steps 1 through 5 use a pinned Chromium build, which is what makes output
byte-reproducible across machines. Step 6 is a last-resort fallback whose version
drifts with the user's browser updates, and emits a warning saying so.

`chromium-headless-shell` is used rather than full Chromium: smaller download,
faster startup, and it is the build Playwright uses for headless mode by default.

## Modules

| File | Responsibility | Depends on |
|---|---|---|
| `src/size.ts` | Sizing math: intrinsic size plus flags to output dimensions | nothing |
| `src/discover.ts` | Paths to `{input, output}` pairs; recursion and tree mirroring | `node:fs` |
| `src/browser.ts` | Resolution chain, launch, page pool | `playwright-core` |
| `src/page.ts` | In-page normalize and measure function | nothing (runs in browser) |
| `src/render.ts` | One SVG file to one PNG on disk | `browser`, `page`, `size` |
| `src/cli.ts` | Argument parsing, help text, exit codes | `node:util` |
| `src/index.ts` | Wires discovery, pool, and reporting together | all |

`size.ts` and `discover.ts` have no browser dependency, which is what makes the
bulk of the logic testable without launching anything.

## Data flow

```
paths → discover → [{input, output}]
                        ↓
             pool of N pages, shared queue
                        ↓
   goto(file://input) → wait load + fonts + images
                        ↓
   evaluate(normalize): ensure viewBox, read intrinsic size
                        ↓
   size.ts: intrinsic + flags → target w,h  (clamp check)
                        ↓
   evaluate: set width/height to target
                        ↓
   screenshot(omitBackground unless --background) → write output
                        ↓
              collect result or error
                        ↓
                summary, exit code
```

## Error handling

Each file is isolated. A failure records the path and reason, and the batch
continues. The run ends with a summary of successes and failures, exiting 1 if
anything failed and 0 otherwise.

Cases handled explicitly, each with a message naming the file:

- File is not valid XML or has no root `<svg>` element
- SVG has no resolvable dimensions (no width/height, no viewBox, zero bbox)
- Computed dimensions exceed the 16384 px clamp
- Output path is not writable
- A requested font family was substituted (warning by default, error under `--strict-fonts`)
- No usable browser found, after the whole resolution chain fails

Conflicting flags and unknown flags fail immediately with usage text, before any
browser launches.

## Testing

Pure unit tests with `node:test` cover `size.ts` — unit conversion, aspect-ratio
derivation, flag precedence, clamp boundaries — and `discover.ts` against a
temporary directory tree, covering recursion, mirroring, and non-SVG filtering.

Integration tests render fixture SVGs and assert exact PNG dimensions plus pixel
probes at known coordinates. Fixtures cover the cases most likely to break:

| Fixture | Guards against |
|---|---|
| Plain shape with `viewBox` | baseline |
| `width`/`height`, no `viewBox` | the viewBox synthesis path |
| Percentage dimensions | intrinsic-size fallback to bbox |
| Embedded local `@font-face` | base URL correctness |
| External `<image href>` | base URL correctness and image decode wait |
| Gradient with transparency | `omitBackground` and alpha preservation |
| Dimensions in `mm` / `pt` | unit conversion |
| `text-anchor=middle` with a mid-string `<tspan>` | per-chunk re-anchoring regressions |
| Text naming an uninstalled font | substitution detection via CDP |

## Packaging

Built with esbuild to a single bundled JS file, then Node SEA to a Windows
executable. Four release assets, mirroring the convention used across these
projects:

| Variant | Size | Node needed |
|---|---|---|
| Portable | ~130 MB | no — unzip and run, Chromium bundled |
| Single file | ~130 MB | no — one `.exe`, unpacks on first run, slower launch |
| Single file, thin | ~45 MB | no — one `.exe`, downloads and caches Chromium on first run |
| Node-dependent | ~2 MB | yes — folder or npm, uses an existing Playwright install |

The variants differ only in which step of the browser resolution chain succeeds,
so they share one code path.

## Dependencies

Runtime: `playwright-core` alone. The full `playwright` package bundles a browser
installer and test runner that this tool does not use.

Dev: `typescript`, `esbuild`. Tests use the built-in `node:test` runner.
