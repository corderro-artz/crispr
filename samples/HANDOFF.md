# Brand PNG regeneration — handoff

Source: `corderro-artz/corderro-artz.github.io`, `public/brand/`
Regenerated: 2026-09-16

## What was wrong

Every affected SVG uses this shape:

```
<text text-anchor="middle">VAPOR<tspan fill="#a11f31">S</tspan>OFT</text>
```

The previous converter **re-anchored each `<tspan>` chunk independently** at the
text element's `x`, rather than centring the text run as a whole. The SVG spec
anchors the whole chunk. So `VAPOR`, `S`, and `OFT` were each centred on the same
point and drew on top of each other.

Severity tracked tspan position:

| Wordmark | tspan position | Damage |
|---|---|---|
| `SE<tspan>N</tspan>` | last char | one letter displaced |
| `AKIR<tspan>A</tspan>` | last char | one letter displaced |
| `KAT<tspan>A</tspan>` | last char | one letter displaced |
| `NFT<tspan>Y</tspan>` | last char | one letter displaced |
| `VAPOR<tspan>S</tspan>OFT` | middle | three runs stacked |

## Second defect: fonts

The SVGs request `Noto Sans JP` and `Noto Sans`. Neither is installed on a
default Windows machine, and **the site never loads them either** —
`src/styles/global.css` uses Manrope, Zen Kaku Gothic New, Syncopate and Space
Grotesk. So the SVG text renders in whatever each visitor happens to have.

These PNGs were rendered with the real Noto families supplied explicitly,
matching what the SVG source declares. Every text node was verified via
Chrome DevTools Protocol `CSS.getPlatformFontsForNode` to have actually
rasterized with a Noto family — no substitution.

**This leaves the SVGs themselves inconsistent in-browser, and it cannot be fixed
from CSS.** The site serves these SVGs directly to visitors:



An SVG loaded through `<img>` renders in an isolated context: it cannot see the
page stylesheet and cannot fetch webfonts. So adding Noto to `global.css` would
**not** reach these marks. Each visitor gets whatever system font happens to
match — Yu Gothic on a Japanese-enabled Windows box, something else on macOS,
Android or Linux.

That leaves two real options: convert the wordmark text to paths, or embed the
font inside each SVG as a data URI. Embedding is impractical here because the CJK
glyphs need Noto Sans JP, which is ~9.5 MB. **Converting text to paths is the fix.**
It also makes the tspan anchoring bug structurally impossible, since there would
be no text runs left to anchor. Out of scope for this handoff.

## What to replace

Drop-in: all 22 PNGs have **identical dimensions** to the files they replace, so
no markup or reference changes are needed.

```
brand-png/<brand>/<name>.png  ->  public/brand/<brand>/png/<name>.png
```

## Do NOT "fix" these

`vaporsoft-favicon.png` and `vaporsoft-favicon-light.png` are ~670 bytes. That is
correct — the source is two rects with no text. They were never malformed.

`public/brand/vaporsoft/vaporsoft-favicon-256.png` sits outside the `png/`
subfolder and has no SVG counterpart in the repo. It was not regenerated.

## Verification

- 22/22 rendered, dimensions match existing files exactly
- 0 font substitutions, confirmed per text node via CDP
- Transparent backgrounds preserved (`omitBackground`)
