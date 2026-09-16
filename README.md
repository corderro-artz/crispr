[![Vaporsoft](https://raw.githubusercontent.com/corderro-artz/corderro-artz.github.io/main/public/brand/vaporsoft/vaporsoft-logo.svg)](https://www.vaporsoft.dev)
[![crispr](https://raw.githubusercontent.com/corderro-artz/corderro-artz.github.io/main/public/brand/crispr/crispr-icon.svg)](https://github.com/corderro-artz/crispr)

# crispr

**Lossless SVG to PNG, rasterized by a real browser engine.**

crispr converts SVG files to PNG at any resolution by handing them to headless Chromium and capturing the result. Most converters reimplement the SVG specification and diverge from it in the details; crispr does not implement it at all, so text shaping, font hinting, filters, gradients, clip paths and blend modes come out exactly as a browser draws them. The part a screenshot cannot solve is fonts: an SVG naming a font the machine lacks still renders, silently substituted, and the output looks correct while being the wrong design. crispr detects that per text node over the DevTools Protocol and fetches the font the file actually asked for.

**Access**  
[![Release](https://img.shields.io/github/v/release/corderro-artz/crispr?label=Download&logo=github&logoColor=white)](https://github.com/corderro-artz/crispr/releases/latest)

**Delivery**  
[![Tests](https://img.shields.io/badge/tests-122%20passing-3d6b52)](#testing)
[![Warnings](https://img.shields.io/badge/warnings-0-3d6b52)](#workflow-notes)
[![Release](https://img.shields.io/github/v/tag/corderro-artz/crispr?sort=semver&label=Release&logo=git&logoColor=white)](https://github.com/corderro-artz/crispr/tags)
[![License: MIT](https://img.shields.io/badge/License-MIT-a11f31?logo=open-source-initiative&logoColor=white)](LICENSE)

**Runtime**  
[![Node 22+](https://img.shields.io/badge/Node-22%2B-5FA04E?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Chromium](https://img.shields.io/badge/engine-Chromium%20headless%20shell-1f6feb?logo=googlechrome&logoColor=white)](https://developer.chrome.com/blog/chrome-headless-shell)
[![Platform](https://img.shields.io/badge/platform-windows%20x64-lightgrey)](#requirements)

## Table of Contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Concepts](#concepts)
- [Architecture](#architecture)
- [Command Line](#command-line)
- [Development](#development)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Links](#links)
- [Contributing](#contributing)
- [License](#license)

## Overview

crispr takes one file, one directory, or several of both, converts every `.svg` it finds, and writes PNGs to an output folder. Everything else is ignored. The rendering is Chromium's; the parts that are crispr's own are the sizing arithmetic, the font verification, and the batching.

### Capabilities

| Capability | Details |
| --- | --- |
| Input | One file, a directory, or several of both; only `.svg` is converted |
| Output | PNG at exact integer dimensions, transparent by default |
| Sizing | The SVG's own size, or `--scale`, `--dpi`, `--width`, `--height` |
| Font verification | Per text node, over the DevTools Protocol |
| Font repair | Missing families fetched from Google Fonts and cached per machine |
| Batching | One browser, one context, a pool of reused pages |
| Isolation | One malformed file never aborts a batch |
| Exit codes | `0` success, `1` a file failed or a font was substituted under `--strict-fonts`, `2` usage |
| Packaging | A Windows executable with no prerequisites |

## Requirements

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | 22+ | Only for the source and the Node-dependent build |
| Chromium | Any recent build | Found automatically; see [Installation](#installation) |
| Network | First run only | To fetch a missing font, once per family per machine |

> The portable build carries its own Chromium and needs neither Node nor a network connection.

### Dependencies

| Category | Packages |
| --- | --- |
| Runtime | `playwright-core` |
| Build | `typescript`, `esbuild`, `postject` |
| Tests | `node:test` (built in) |

## Installation

Prebuilt Windows builds are on the [releases page](https://github.com/corderro-artz/crispr/releases/latest).

| Shape | Size | Node needed | For |
| --- | --- | --- | --- |
| **Portable** | 147 MB | No | Unzip anywhere and run. Chromium included, works offline. Start here if you are unsure. |
| **Single file, thin** | 36 MB | No | The same `crispr.exe` without Chromium. Downloads it once on first run and caches it. |
| **Node-dependent** | 3 MB | Yes | A folder and a `crispr.cmd` shim, using a Node and a Chromium you already have. |

Every shape carries `node_modules/playwright-core` as real files. It cannot be folded into the executable: it lazily requires `chromium-bidi` submodules by path and resolves its own driver relative to its location on disk, so a bundled copy builds cleanly and then cannot launch anything.

crispr keeps its font cache in `%LOCALAPPDATA%\crispr`, so a family is downloaded once per machine rather than once per run. Delete the folder and nothing is left behind.

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

That writes `logo.png` at the SVG's own dimensions into `crispr-out` beside the executable. The workflows worth knowing:

```bash
crispr assets/ -r -o dist/png --scale 2          # a whole tree at 2x, mirrored
crispr icon.svg --width 512                      # pin a width, height follows the aspect ratio
crispr icon.svg --background "#07080b"           # opaque instead of transparent
crispr brand/ --strict-fonts                     # fail the build on a wrong typeface
crispr brand/ --list-fonts                       # report fonts, write nothing
```

## Concepts

### Why a browser

Three decisions define the renderer, each chosen over a more obvious alternative.

**The file is loaded by navigating to it.** `file:///…/logo.svg` makes Chromium render the SVG as a standalone document, so `<image href="./texture.png">`, an `@font-face` pointing at a local file, and XML entity declarations all resolve against the file's real location. Reading the file and injecting it into a wrapper page silently breaks every one of those.

**Scaling rewrites the SVG rather than setting `deviceScaleFactor`.** crispr guarantees the element has a `viewBox`, then sets `width` and `height` to the exact target pixels and lets Chromium re-rasterize the vectors. Dimensions come out as exact integers, where a fractional device scale such as `800/331` rounds unpredictably. It also keeps the device scale factor at 1 for every file, so an entire run shares one browser context instead of one per file.

**`networkidle` is not used.** It costs 500 ms of enforced silence per file whether or not the file references anything external. crispr waits for `load`, then `document.fonts.ready`, then for every `<image>` to decode — the same guarantee without the fixed penalty.

### Sizing

The default is the SVG's own size: one SVG pixel becomes one PNG pixel.

| Flags | Output |
| --- | --- |
| *(none)* | The intrinsic size |
| `--scale 2` | Twice the intrinsic size |
| `--dpi 192` | The same, expressed as a resolution |
| `--width 800` | 800 wide, height from the aspect ratio |
| `--height 400` | 400 tall, width from the aspect ratio |
| `--width 800 --height 100` | Exactly 800×100; the SVG fits per its own `preserveAspectRatio` |

Intrinsic size is resolved from the `width` and `height` attributes, then the `viewBox`, then the content's bounding box. That order carries more weight than it appears to: a standalone SVG with only a `viewBox` defaults to 100%×100%, so measuring its client rectangle returns the viewport rather than the artwork.

Rounding happens once, at the end. Combining `--scale` with `--width` is a usage error rather than one silently winning. Anything over 16384 px per side is refused, because past Chromium's texture limit it returns a truncated image instead of failing.

### Fonts

`document.fonts.check()` cannot verify a font — it returns `true` for families that do not exist, including invented ones. crispr uses the DevTools Protocol's `CSS.getPlatformFontsForNode`, which reports the font Chromium actually rasterized with, per text node.

What counts as correct is the **first** family in the stack, not any of them. Given `font-family="Noto Sans JP, Yu Gothic, Meiryo, sans-serif"`, landing on Yu Gothic is CSS behaving exactly as specified and still not the design. Since crispr can fetch Noto Sans JP, correct-per-CSS is too low a bar. Per-glyph fallback stays legitimate: a node whose preferred family lacks CJK coverage reports both that family and the CJK one, and seeing the preferred family anywhere is enough.

A substituted family is looked up in `google/fonts` over `raw.githubusercontent.com`, trying the `ofl`, `apache` and `ufl` licence directories in turn, registered as a `FontFace` from a base64 data URI, and the file is re-captured. Only the preferred family is fetched — pulling the rest of the stack would download the very fallbacks the author listed to avoid downloads.

```bash
crispr brand/ --font "google:Noto Sans JP"        # fetch a family up front
crispr brand/ --font "Noto Sans=./NotoSans.ttf"   # supply one from disk
crispr brand/ --font-fallback "Noto Sans JP=Yu Gothic"
crispr brand/ --no-font-fetch --strict-fonts      # offline, and fail on anything missing
```

`--font <path>` reads the family name out of the font's own `name` table. WOFF and WOFF2 are Brotli compressed, so their name is unreadable without a decompressor that is not worth the binary size; those need the explicit `"Family=path"` form, and crispr says so rather than guessing.

> **Note:** A populated cache plus `--no-font-fetch` is the reproducibility boundary — a build in that state cannot silently change. Pipelines that care should restore the cache and pass the flag.

> **Note:** Fonts are downloaded, not redistributed. Google Fonts families carry their own licences (OFL, Apache, UFL); rendering with them is unrestricted, but check before shipping a font file.

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/diagrams/architecture-light.svg">
  <img alt="CRISPR architecture: discover input and output paths, load each in a pooled browser page, guarantee a viewBox and verify fonts over CDP with repair from cache or Google, then resolve exact pixels, screenshot, write, and collect a summary and exit code." src="docs/diagrams/architecture-light.svg">
</picture>

<sub>Source: <a href="docs/diagrams/architecture.mmd"><code>docs/diagrams/architecture.mmd</code></a></sub>

| Module | Responsibility |
| --- | --- |
| `src/size.ts` | Sizing arithmetic. No browser dependency |
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
| `src/playwright.ts` | Locating `playwright-core` on disk at runtime |

### Design Principles

- Keep the heavy machinery out of the pure logic. Sizing, discovery and font parsing carry no browser dependency, so most of the behaviour is testable without launching anything.
- Detect rather than assume. Whether a font resolved and whether a browser will launch are both answered by trying, not by inspecting.
- Report what actually happened. A substituted font is reported by default, because a PNG in the wrong typeface looks correct and nothing else will ever mention it.
- Fail one file, not the batch.

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

`-H` carries `--height` because `-h` is help. Usage errors surface before any browser starts.

Files that are not `.svg` are skipped without comment, since pointing the tool at a mixed asset folder is the normal case rather than a mistake. A path that does not exist is a mistake, and says so.

### Browser Resolution

crispr looks for a browser in this order, and the first that actually launches wins:

| Order | Source | Pinned |
| --- | --- | --- |
| 1 | `--browser-path` | Yes |
| 2 | `CRISPR_BROWSER` | Yes |
| 3 | A `browsers/` folder beside the executable — the portable build | Yes |
| 4 | `%LOCALAPPDATA%\crispr\browsers` — the thin build's cache | Yes |
| 5 | Playwright's own install | Yes |
| 6 | System Microsoft Edge, then Google Chrome | No |

Only the last is unpinned, and crispr says so when it uses one: branded browsers update themselves and their headless mode differs from the headless shell, so output can drift between machines.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run package
```

### Testing

122 tests, split by what they need.

```bash
npm test                 # unit, no browser, no network
npm run test:integration # integration, launches Chromium
npm run test:all
```

The unit suite covers sizing, discovery, `name`-table parsing, Google Fonts resolution against a stubbed fetcher, the registry, argument parsing and reporting. The integration suite renders real fixtures and spawns the CLI as a child process.

Several of the sharper defects were reachable only from integration, which is why it exists:

| Defect | Only visible when |
| --- | --- |
| A client rect returns the viewport for a sizeless SVG | A file has no `width`, `height` or `viewBox` |
| CDP reports a font's own name, not its registered alias | A font is supplied under a different family |
| `document.fonts` is cleared by navigation | A second file reuses a page |
| A font lookup raced itself | More than one page renders at once |
| Probing `executablePath()` misses an `--only-shell` install | Chromium was installed without full Chrome |

### Workflow Notes

- `npm run typecheck` runs `tsc --noEmit` under `strict` with `noUncheckedIndexedAccess`. It is expected to be silent.
- `npm run build` bundles to `dist/crispr.js` with esbuild.
- `npm run package` additionally produces a CommonJS bundle, injects it into a copy of the Node binary with `postject` to make `crispr.exe`, and assembles the three release shapes into `build/release`.
- `playwright-core` stays external in both bundles. See [Installation](#installation).

## Deployment

Releases are cut from a tag and carry all three shapes.

```bash
npm run test:all
npm run package
git tag -a v0.1.0 -m "crispr 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 build/release/*.zip
```

- Targets: [GitHub Releases](https://github.com/corderro-artz/crispr/releases)
- Artefacts: portable, single file thin, and node-dependent zips, plus `MANIFEST.md`
- Platform: Windows x64. The core is platform-neutral; only the builds are Windows.

## Troubleshooting

> **Note:** *"no usable browser found"* lists every candidate that was tried and why each failed. Install one with `npx playwright install chromium --only-shell`, or pass `--browser-path`.

> **Note:** A font that is not on Google Fonts cannot be fetched. Supply it with `--font "Family=path"`, map it to something installed with `--font-fallback`, or accept the substitution — it is reported either way.

> **Note:** Output differing between two machines usually means one of them fell through to a system browser. `--verbose` prints which candidate won, and crispr warns when the winner is unpinned.

> **Note:** A PNG larger than 16384 px on a side is refused rather than written. Chromium returns a truncated image past that limit, so the check has to happen before the capture.

## Links

| Resource | URL |
| --- | --- |
| Repository | [github.com/corderro-artz/crispr](https://github.com/corderro-artz/crispr) |
| Releases | [github.com/corderro-artz/crispr/releases](https://github.com/corderro-artz/crispr/releases) |
| Tags | [Git tags](https://github.com/corderro-artz/crispr/tags) |
| Design specification | [docs/superpowers/specs](docs/superpowers/specs/2026-09-16-crispr-design.md) |
| Implementation plan | [docs/superpowers/plans](docs/superpowers/plans/2026-09-16-crispr-cli.md) |
| Issues | [github.com/corderro-artz/crispr/issues](https://github.com/corderro-artz/crispr/issues) |
| Pull requests | [github.com/corderro-artz/crispr/pulls](https://github.com/corderro-artz/crispr/pulls) |
| Actions | [github.com/corderro-artz/crispr/actions](https://github.com/corderro-artz/crispr/actions) |
| Security | [GitHub security overview](https://github.com/corderro-artz/crispr/security) |
| License | [LICENSE](LICENSE) |
| Vaporsoft | [vaporsoft.dev](https://www.vaporsoft.dev) |

## Contributing

1. Create a branch from `main` for the change.
2. Write tests first — pure logic in `tests/unit`, anything touching a browser in `tests/integration`.
3. Run `npm run typecheck` and `npm run test:all` before opening a pull request.
4. Run `npm run package` when the change affects packaging or browser resolution.
5. Open a pull request with enough context to review behaviour, architecture and output fidelity.

## License

MIT. See [LICENSE](LICENSE).

---

Copyright © 2026 [Corderro Artz](https://github.com/corderro-artz) / [Vaporsoft](https://www.vaporsoft.dev).
