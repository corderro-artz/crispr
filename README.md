[![Vaporsoft](https://raw.githubusercontent.com/corderro-artz/corderro-artz.github.io/main/public/brand/vaporsoft/vaporsoft-logo.svg)](https://www.vaporsoft.dev)

# crispr

**Lossless SVG to PNG, rasterized by a real browser engine.**

Most SVG converters reimplement the spec. crispr does not: it hands the file to headless Chromium
and screenshots the result, so what lands in the PNG is what a browser draws — the same text
shaping, the same hinting, the same filters, gradients, clip paths and blend modes. Anything that
renders correctly on a page renders correctly here, because it is the same code doing the rendering.

The part that is not a screenshot is fonts. An SVG naming a font the machine does not have still
renders; Chromium quietly substitutes another and the output looks fine while being the wrong
design. crispr detects that over the DevTools Protocol, then goes and fetches the font the file
actually asked for.

**Delivery**
[![Tests](https://img.shields.io/badge/tests-122%20passing-3d6b52)](#testing)
[![Node 22+](https://img.shields.io/badge/Node-22%2B-5FA04E?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-a11f31?logo=open-source-initiative&logoColor=white)](LICENSE)

**Runtime**
[![Chromium](https://img.shields.io/badge/engine-Chromium%20headless%20shell-1f6feb?logo=googlechrome&logoColor=white)](https://developer.chrome.com/blog/chrome-headless-shell)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20linux%20%7C%20macOS-lightgrey)](#requirements)

## Table of Contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Command Line](#command-line)
- [Sizing](#sizing)
- [Fonts](#fonts)
- [Architecture](#architecture)
- [Testing](#testing)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Links](#links)
- [Contributing](#contributing)
- [License](#license)

## Overview

### Capabilities

| Capability | Details |
| --- | --- |
| Input | One file, a directory, or several of both; only `.svg` is converted |
| Output | PNG at exact integer dimensions, transparent by default |
| Sizing | The SVG's own size, or `--scale`, `--dpi`, `--width`, `--height` |
| Fonts | Substitution detected per text node, then repaired from Google Fonts |
| Batching | One browser, one context, a pool of reused pages |
| Isolation | One malformed file never aborts a batch |
| Packaging | A single Windows executable with no prerequisites |

### Three decisions worth knowing

**The SVG is loaded by navigating to it.** `file:///…/logo.svg` makes Chromium render it as a
standalone document, so `<image href="./texture.png">`, an `@font-face` pointing at a local file,
and XML entity declarations all resolve against the file's real location. Reading the file and
injecting it into a wrapper page — the obvious approach — silently breaks every one of those.

**Scaling rewrites the SVG rather than setting `deviceScaleFactor`.** crispr guarantees the element
has a `viewBox`, then sets `width` and `height` to the exact target pixels and lets Chromium
re-rasterize the vectors. Output dimensions are therefore exact integers, where a fractional device
scale factor such as `800/331` rounds unpredictably. It also means the device scale factor is always
1, so an entire run shares **one browser context** instead of one per file.

**`networkidle` is not used.** It costs 500 ms of enforced silence per file whether or not the file
references anything. crispr waits for `load`, then `document.fonts.ready`, then for every `<image>`
to decode — the same guarantee, without the fixed penalty.

## Requirements

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | 22+ | Only for the source and Node-dependent builds |
| Chromium | any recent | Found automatically; see [Installation](#installation) |
| Network | first run only | To fetch a missing font, once per family per machine |

## Installation

Prebuilt Windows builds are on the [releases page](https://github.com/corderro-artz/crispr/releases/latest).

| Shape | Size | Node needed | For |
| --- | --- | --- | --- |
| **Portable** | 130 MB | No | Unzip anywhere and run. Start here if you are unsure. |
| **Single file** | 130 MB | No | One `.exe`. Unpacks itself on first launch, so that launch is slower. |
| **Single file, thin** | 45 MB | No | One `.exe` that downloads Chromium on first run and caches it. |
| **Node-dependent** | 2 MB | Yes | The same, as a folder, using a Chromium you already have. |

The shapes differ only in where the browser comes from. crispr looks for one in this order, and the
first that launches wins:

1. `--browser-path`
2. `CRISPR_BROWSER`
3. a `browsers/` folder beside the executable — the portable build
4. `%LOCALAPPDATA%\crispr\browsers` — the thin build's cache
5. Playwright's own install
6. system Microsoft Edge, then Google Chrome

Only the last is unpinned, and crispr says so when it uses one: branded browsers update themselves
and their headless mode differs from the headless shell, so output can drift between machines.

To build from source:

```bash
git clone https://github.com/corderro-artz/crispr.git
cd crispr
npm install
npx playwright install chromium --only-shell
npm run build
```

## Quick Start

```bash
crispr logo.svg
```

That writes `logo.png` at the SVG's own dimensions into `crispr-out` beside the executable. Some
things you are more likely to actually want:

```bash
crispr assets/ -r -o dist/png --scale 2          # a whole tree at 2x, mirrored
crispr icon.svg --width 512                      # pin a width, height follows the aspect ratio
crispr icon.svg --background "#07080b"           # opaque instead of transparent
crispr brand/ --strict-fonts                     # fail the build on a wrong typeface
crispr brand/ --list-fonts                       # report fonts, write nothing
```

## Command Line

```bash
crispr --help
```

| Flag | What it does |
| --- | --- |
| `-o, --out <dir>` | Output directory. Defaults to `crispr-out` beside the executable |
| `-r, --recursive` | Recurse into subdirectories, mirroring the tree into the output |
| `-s, --scale <n>` | Multiply the intrinsic size |
| `-w, --width <px>` | Pin the width; height follows the aspect ratio |
| `-H, --height <px>` | Pin the height; width follows the aspect ratio |
| `--dpi <n>` | Equivalent to `--scale n/96` |
| `-b, --background <css>` | Solid background colour. Default is transparent |
| `--font <spec>` | A font file, `"Family=path"`, or `"google:Family"`. Repeatable |
| `--font-dir <dir>` | Register every font in a directory |
| `--font-fallback <spec>` | `"Requested=Available"` family remap. Repeatable |
| `--no-font-fetch` | Never download a missing font |
| `--strict-fonts` | Treat a font substitution as an error |
| `--list-fonts` | Report requested versus actual fonts, write no PNGs |
| `-j, --jobs <n>` | Concurrent pages. Default `min(cpus, 8)` |
| `--browser-path <p>` | An explicit Chromium executable |
| `--quiet` / `--verbose` | Errors only / per-file detail |

`-H` carries `--height` because `-h` is help. Exit codes are `0` for success, `1` when a file failed
or `--strict-fonts` caught a substitution, and `2` for a usage error — which is reported before any
browser starts.

Files that are not `.svg` are skipped without comment, since pointing the tool at a mixed asset
folder is the normal case rather than a mistake. A path that does not exist is a mistake, and says so.

## Sizing

The default is the SVG's own size: one SVG pixel becomes one PNG pixel.

| Flags | Output |
| --- | --- |
| *(none)* | The intrinsic size |
| `--scale 2` | Twice the intrinsic size |
| `--dpi 192` | The same, expressed as a resolution |
| `--width 800` | 800 wide, height from the aspect ratio |
| `--height 400` | 400 tall, width from the aspect ratio |
| `--width 800 --height 100` | Exactly 800×100; the SVG fits per its own `preserveAspectRatio` |

Intrinsic size is resolved from the `width` and `height` attributes, then the `viewBox`, then the
content's bounding box. That order matters more than it looks: a standalone SVG with only a
`viewBox` defaults to 100%×100%, so measuring its client rectangle returns the *viewport* rather
than the artwork.

Rounding happens once, at the end. Combining `--scale` with `--width` is a usage error rather than
one silently winning. Anything over 16384 px per side is refused, because past Chromium's texture
limit it returns a truncated image instead of failing.

## Fonts

This is the part a screenshot cannot solve on its own, and the reason crispr exists in its current
shape.

**Detection.** `document.fonts.check()` is unusable — it returns `true` for families that do not
exist, including invented ones. crispr uses the DevTools Protocol's `CSS.getPlatformFontsForNode`,
which reports the font Chromium *actually rasterized with*, per text node.

**What counts as correct.** The **first** family in the stack, not any of them. Given
`font-family="Noto Sans JP, Yu Gothic, Meiryo, sans-serif"`, landing on Yu Gothic is CSS behaving
exactly as specified — and still not the design. Since crispr can go and fetch Noto Sans JP,
correct-per-CSS is too low a bar. Per-glyph fallback stays legitimate: a Latin font yielding to a
CJK font for CJK glyphs reports both, and seeing the preferred family anywhere is enough.

**Repair.** A substituted family is looked up in `google/fonts` over `raw.githubusercontent.com`,
trying the `ofl`, `apache` and `ufl` licence directories in turn, then registered as a `FontFace`
from a base64 data URI and the file is re-captured. Only the preferred family is fetched — pulling
the rest of the stack would download the very fallbacks the author listed to avoid downloads.

Downloads are cached under `%LOCALAPPDATA%\crispr\fonts`, so a family costs one download per machine
rather than one per run. That cache is also the reproducibility boundary: a populated cache plus
`--no-font-fetch` is a build that cannot silently change.

```bash
crispr brand/ --font "google:Noto Sans JP"        # fetch a family up front
crispr brand/ --font "Noto Sans=./NotoSans.ttf"   # supply one from disk
crispr brand/ --font-fallback "Noto Sans JP=Yu Gothic"
crispr brand/ --no-font-fetch --strict-fonts      # offline, and fail on anything missing
```

`--font <path>` reads the family name out of the font's own `name` table. WOFF and WOFF2 are Brotli
compressed, so their name is unreadable without a decompressor that is not worth the binary size —
those need the explicit `"Family=path"` form, and crispr says so rather than guessing.

> **Note:** Fonts are downloaded, not redistributed. Google Fonts families carry their own licences
> (OFL, Apache, UFL); rendering with them is unrestricted, but check before shipping a font file.

## Architecture

```text
paths -> discover -> [{input, output}]
                          |
               one browser, one context
               pool of N reused pages
                          |
  goto(file://input) -> load, fonts.ready, images decoded
                          |
  measure + guarantee a viewBox        (src/page.ts)
                          |
  detect substitution over CDP         (src/render.ts)
     `-> repair: cache, else Google    (src/fonts/*)
                          |
  intrinsic + flags -> exact pixels    (src/size.ts)
                          |
  resize, screenshot, write
                          |
  collect -> summary -> exit code      (src/report.ts)
```

| Module | Responsibility |
| --- | --- |
| `src/size.ts` | Sizing maths. No browser dependency |
| `src/discover.ts` | Paths to jobs; recursion and tree mirroring |
| `src/fonts/name-table.ts` | Family name from an sfnt `name` table |
| `src/fonts/google.ts` | Family resolution and download |
| `src/fonts/cache.ts` | On-disk font cache |
| `src/fonts/registry.ts` | Fonts from flags, cache and network |
| `src/browser.ts` | Browser candidates, launch, page pool |
| `src/page.ts` | Functions that run inside the page |
| `src/render.ts` | One SVG to one PNG, including font repair |
| `src/report.ts` | Summaries and exit codes |
| `src/cli.ts` | Argument parsing and help |

### Design Principles

- Keep the heavy machinery out of the pure logic: sizing, discovery and font parsing carry no
  browser dependency, so most of the behaviour is testable without launching anything.
- Detect rather than assume. Whether a font resolved and whether a browser will launch are both
  answered by trying, not by inspecting.
- Report what actually happened. A substituted font is reported by default, because a PNG in the
  wrong typeface looks correct and nothing else will ever mention it.
- Fail one file, not the batch.

## Testing

```bash
npm test                 # unit, no browser
npm run test:integration # integration, launches Chromium
npm run test:all
```

122 tests. The unit suite covers sizing, discovery, `name`-table parsing, Google Fonts resolution
against a stubbed fetcher, the registry, argument parsing and reporting — no network, no browser.
The integration suite renders real fixtures and spawns the CLI as a child process.

Several of the sharper bugs were only reachable from integration, which is why it exists:

| Bug | Only visible when |
| --- | --- |
| Client rect returns the viewport for a sizeless SVG | A file has no `width`, `height` or `viewBox` |
| CDP reports a font's own name, not its registered alias | A font is supplied under a different family |
| `document.fonts` is cleared by navigation | A second file reuses a page |
| A font lookup raced itself | More than one page renders at once |
| Probing `executablePath()` misses a `--only-shell` install | Chromium was installed without full Chrome |

## Development

```bash
npm run typecheck
npm test
npm run build
```

`npm run build` bundles to `dist/crispr.js` with esbuild. `playwright-core` stays external: it ships
platform-specific driver files and spawns its own subprocess, so bundling it produces a file that
builds and then cannot launch anything.

## Troubleshooting

> **Note:** *"no usable browser found"* — the error lists every candidate that was tried and why each
> failed. Install one with `npx playwright install chromium --only-shell`, or pass `--browser-path`.

> **Note:** A font that is not on Google Fonts cannot be fetched. Supply it with
> `--font "Family=path"`, map it to something installed with `--font-fallback`, or accept the
> substitution — it is reported either way.

> **Note:** Output differs between two machines? Check whether one of them fell through to a system
> browser. `--verbose` prints which candidate won, and crispr warns when the winner is unpinned.

## Links

| Resource | URL |
| --- | --- |
| Repository | [github.com/corderro-artz/crispr](https://github.com/corderro-artz/crispr) |
| Releases | [github.com/corderro-artz/crispr/releases](https://github.com/corderro-artz/crispr/releases) |
| Issues | [github.com/corderro-artz/crispr/issues](https://github.com/corderro-artz/crispr/issues) |
| CI / CD | [github.com/corderro-artz/crispr/actions](https://github.com/corderro-artz/crispr/actions) |
| Design spec | [docs/superpowers/specs](docs/superpowers/specs/2026-09-16-crispr-design.md) |
| Implementation plan | [docs/superpowers/plans](docs/superpowers/plans/2026-09-16-crispr-cli.md) |
| Vaporsoft | [vaporsoft.dev](https://www.vaporsoft.dev) |

## Contributing

1. Fork the repository and branch from `main`
2. Write tests first — pure logic in `tests/unit`, anything touching a browser in `tests/integration`
3. Run `npm run typecheck` and `npm run test:all`
4. Open a pull request

## License

MIT. See [LICENSE](LICENSE).

---

Copyright © 2026 [Corderro Artz](https://github.com/corderro-artz) / [Vaporsoft](https://www.vaporsoft.dev).
