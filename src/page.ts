/**
 * Functions that run inside the page.
 *
 * These are serialised to the browser by `page.evaluate`, so they must be
 * self-contained: no imports, no closure over module scope, only their argument.
 */

export interface Measured {
  width: number;
  height: number;
}

/**
 * Wait for everything that affects rendering, without `networkidle`.
 *
 * `networkidle` costs 500 ms of enforced silence on every file whether or not it
 * has external references. Waiting for the specific things that matter — fonts
 * resolved, images decoded — is the same guarantee at a fraction of the cost.
 */
export async function waitForReady(): Promise<void> {
  await document.fonts.ready;

  const images = [...document.querySelectorAll('image')];
  await Promise.all(
    images.map(async (image) => {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
      if (!href) return;
      await new Promise<void>((resolve) => {
        // An <image> that fails to load must not hang the render; a missing
        // reference is the SVG's problem and shows up in the output.
        const done = () => resolve();
        const probe = new Image();
        probe.onload = done;
        probe.onerror = done;
        probe.src = new URL(href, document.baseURI).href;
      });
    }),
  );
}

/**
 * Resolve the SVG's intrinsic size and guarantee it has a viewBox.
 *
 * The order matters. A standalone SVG with only a viewBox defaults to 100%×100%
 * and its bounding rect reports the *viewport* — 1280×720 — not its own size. So
 * the bounding rect is consulted first only when explicit non-percentage width
 * and height attributes exist, in which case it gives unit conversion (mm, pt,
 * em) for free.
 *
 * Synthesising the viewBox is what later makes resizing work: width and height
 * on an SVG define a canvas, not a transform, so without a viewBox the artwork
 * would sit at original size in the corner of a larger canvas.
 */
export function measureAndNormalize(): Measured {
  const el = document.documentElement as unknown as SVGSVGElement;

  const widthAttr = el.getAttribute('width');
  const heightAttr = el.getAttribute('height');
  const explicit =
    !!widthAttr && !!heightAttr && !widthAttr.includes('%') && !heightAttr.includes('%');

  let width = 0;
  let height = 0;

  if (explicit) {
    const rect = el.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
  } else if (el.viewBox?.baseVal && el.viewBox.baseVal.width > 0) {
    width = el.viewBox.baseVal.width;
    height = el.viewBox.baseVal.height;
  } else {
    const rect = el.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
  }

  if (!el.hasAttribute('viewBox') && width > 0 && height > 0) {
    el.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  return { width, height };
}

/** Resize the SVG to exact pixel dimensions and anchor it at the origin. */
export function applySize(size: { width: number; height: number }): void {
  const el = document.documentElement as unknown as SVGSVGElement;
  el.setAttribute('width', String(size.width));
  el.setAttribute('height', String(size.height));
  el.style.display = 'block';
  el.style.margin = '0';
}

/** Paint a solid background behind the artwork, for `--background`. */
export function applyBackground(color: string): void {
  document.documentElement.style.background = color;
}

/**
 * Register a font at runtime.
 *
 * The weight range is declared wide so a single variable font satisfies every
 * `font-weight` the document asks for.
 */
export async function registerFont(payload: { family: string; base64: string }): Promise<void> {
  const face = new FontFace(payload.family, `url(data:font/ttf;base64,${payload.base64})`, {
    weight: '100 900',
  });
  await face.load();
  document.fonts.add(face);
  await document.fonts.ready;
}

/**
 * The font stack each text-bearing node asked for, paired with a stable index so
 * results can be matched against CDP's per-node font report.
 */
export function requestedFamilies(): { index: number; text: string; families: string[] }[] {
  const nodes = [...document.querySelectorAll('text, tspan')];
  return nodes.map((node, index) => {
    const declared =
      node.getAttribute('font-family') ??
      getComputedStyle(node).fontFamily ??
      '';
    const families = declared
      .split(',')
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    return { index, text: node.textContent ?? '', families };
  });
}
