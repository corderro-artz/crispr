/**
 * Sizing maths. Deliberately free of any browser dependency so the rules that
 * decide a PNG's dimensions can be tested without launching anything.
 */

/** Chromium's per-side texture limit. Beyond it, screenshots come back truncated rather than failing. */
export const MAX_DIMENSION = 16384;

/** CSS reference pixels per inch, the denominator behind `--dpi`. */
const CSS_DPI = 96;

export interface Intrinsic {
  width: number;
  height: number;
}

export interface SizeOptions {
  scale?: number;
  width?: number;
  height?: number;
  dpi?: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Reject flag combinations before anything expensive happens. Conflicting
 * sizing flags are a usage error rather than a silent precedence win, because
 * silently ignoring half of what was asked for produces a plausible wrong
 * answer — the worst kind.
 */
export function validateSizeOptions(opts: SizeOptions): void {
  for (const [name, value] of Object.entries(opts)) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--${name} must be a positive finite number, got ${value}`);
    }
  }

  const pinned = opts.width !== undefined || opts.height !== undefined;
  if (opts.scale !== undefined && pinned) {
    throw new Error('--scale cannot be combined with --width or --height');
  }
  if (opts.dpi !== undefined && pinned) {
    throw new Error('--dpi cannot be combined with --width or --height');
  }
  if (opts.scale !== undefined && opts.dpi !== undefined) {
    throw new Error('--scale cannot be combined with --dpi');
  }
}

/**
 * Turn an intrinsic size plus options into final pixel dimensions.
 *
 * Rounding happens exactly once, at the end. Rounding intermediate values
 * instead would let `--width 800` on a 331-wide source land on 799.
 */
export function computeSize(intrinsic: Intrinsic, opts: SizeOptions): Size {
  if (!(intrinsic.width > 0) || !(intrinsic.height > 0)) {
    throw new Error('SVG has no resolvable dimensions (width, height and viewBox are all absent or zero)');
  }

  const { width, height } = exactSize(intrinsic, opts);

  const out = { width: Math.round(width), height: Math.round(height) };

  if (out.width < 1 || out.height < 1) {
    throw new Error(`computed size ${width}x${height} rounds to zero pixels`);
  }
  if (out.width > MAX_DIMENSION || out.height > MAX_DIMENSION) {
    throw new Error(
      `computed size ${out.width}x${out.height} exceeds Chromium's ${MAX_DIMENSION}px limit`,
    );
  }
  return out;
}

/** The unrounded target size. Split out so rounding stays a single step. */
function exactSize(intrinsic: Intrinsic, opts: SizeOptions): Size {
  const aspect = intrinsic.width / intrinsic.height;

  if (opts.width !== undefined && opts.height !== undefined) {
    return { width: opts.width, height: opts.height };
  }
  if (opts.width !== undefined) {
    return { width: opts.width, height: opts.width / aspect };
  }
  if (opts.height !== undefined) {
    return { width: opts.height * aspect, height: opts.height };
  }

  const scale = opts.scale ?? (opts.dpi !== undefined ? opts.dpi / CSS_DPI : 1);
  return { width: intrinsic.width * scale, height: intrinsic.height * scale };
}
