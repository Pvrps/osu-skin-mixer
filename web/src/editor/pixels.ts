/** Operations on the pixels of an image, as the editor's tools need them. None of this touches the page. */

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** Anything shaped like the browser's ImageData. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A rectangle of whole pixels. Operations given one leave everything outside it alone. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) || 0) as Rgb;

export const rgbToHex = ([r, g, b]: Rgb | Rgba): string => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

export function pixelAt(pixels: Pixels, x: number, y: number): Rgba {
  const i = (y * pixels.width + x) * 4;
  return [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!, pixels.data[i + 3]!];
}

const whole = (pixels: Pixels): Region => ({ x: 0, y: 0, width: pixels.width, height: pixels.height });

function clampRegion(pixels: Pixels, region: Region | null | undefined): Region {
  if (!region) return whole(pixels);

  const x = Math.max(0, Math.min(pixels.width, region.x));
  const y = Math.max(0, Math.min(pixels.height, region.y));

  return { x, y, width: Math.max(0, Math.min(pixels.width, region.x + region.width) - x), height: Math.max(0, Math.min(pixels.height, region.y + region.height) - y) };
}

/** Turns a tolerance of 0 to 100 into how far apart two colours' channels may be and still count as the same. */
const threshold = (tolerance: number) => (Math.max(0, Math.min(100, tolerance)) / 100) * 255;

/** How different the pixel at an offset is from a colour: the largest gap in any one channel. */
function difference(data: Uint8ClampedArray, i: number, colour: Rgba): number {
  const alpha = data[i + 3]!;

  // Fully transparent pixels all look alike, whatever colour is left behind in them.
  if (alpha === 0 && colour[3] === 0) return 0;

  return Math.max(Math.abs(data[i]! - colour[0]), Math.abs(data[i + 1]! - colour[1]), Math.abs(data[i + 2]! - colour[2]), Math.abs(alpha - colour[3]));
}

/**
 * Fills the area around a point with a colour, as a paint bucket does. With `contiguous` off, every pixel of the
 * clicked colour is filled, wherever it is. Returns whether anything changed.
 */
export function floodFill(pixels: Pixels, x: number, y: number, colour: Rgba, tolerance: number, contiguous: boolean, within?: Region | null): boolean {
  const region = clampRegion(pixels, within);
  if (x < region.x || y < region.y || x >= region.x + region.width || y >= region.y + region.height) return false;

  const { data, width } = pixels;
  const target = pixelAt(pixels, x, y);
  const limit = threshold(tolerance);
  let changed = false;

  const paint = (i: number) => {
    if (data[i] !== colour[0] || data[i + 1] !== colour[1] || data[i + 2] !== colour[2] || data[i + 3] !== colour[3]) changed = true;

    data[i] = colour[0];
    data[i + 1] = colour[1];
    data[i + 2] = colour[2];
    data[i + 3] = colour[3];
  };

  if (!contiguous) {
    for (let py = region.y; py < region.y + region.height; py++) {
      for (let px = region.x; px < region.x + region.width; px++) {
        const i = (py * width + px) * 4;
        if (difference(data, i, target) <= limit) paint(i);
      }
    }

    return changed;
  }

  // Each pixel is looked at once: it is marked when queued, as the fill colour itself may match the target.
  const seen = new Uint8Array(pixels.width * pixels.height);
  const queue = [y * width + x];
  seen[queue[0]!] = 1;

  while (queue.length > 0) {
    const index = queue.pop()!;
    const px = index % width;
    const py = (index - px) / width;

    if (difference(data, index * 4, target) > limit) continue;
    paint(index * 4);

    for (const [nx, ny] of [
      [px - 1, py],
      [px + 1, py],
      [px, py - 1],
      [px, py + 1],
    ] as const) {
      if (nx < region.x || ny < region.y || nx >= region.x + region.width || ny >= region.y + region.height) continue;

      const next = ny * width + nx;

      if (!seen[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }

  return changed;
}

/**
 * Changes every pixel of one colour into another, keeping shading: a pixel a little darker than the colour
 * picked ends up a little darker than the new one. Transparency is left as it is.
 */
export function replaceColour(pixels: Pixels, from: Rgba, to: Rgb, tolerance: number, within?: Region | null): boolean {
  const region = clampRegion(pixels, within);
  const { data, width } = pixels;
  const limit = threshold(tolerance);
  let changed = false;

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0 || difference(data, i, from) > limit) continue;

      for (let channel = 0; channel < 3; channel++) data[i + channel] = to[channel]! + (data[i + channel]! - from[channel]!);
      changed = true;
    }
  }

  return changed;
}

export interface Adjustment {
  /** Degrees to turn the hue by, -180 to 180. */
  hue: number;
  /** -100 (grey) to 100 (twice as vivid). */
  saturation: number;
  /** -100 (black) to 100 (white). */
  brightness: number;
  /** How much of the image's opacity to keep, 0 to 100. */
  opacity: number;
}

export const NO_ADJUSTMENT: Adjustment = { hue: 0, saturation: 0, brightness: 0, opacity: 100 };

export const isAdjusted = (a: Adjustment) => a.hue !== 0 || a.saturation !== 0 || a.brightness !== 0 || a.opacity !== 100;

function hueToChannel(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;

  return p;
}

/** Shifts the hue, saturation, brightness and opacity of an image. */
export function adjust(pixels: Pixels, adjustment: Adjustment, within?: Region | null): void {
  const region = clampRegion(pixels, within);
  const { data, width } = pixels;
  const turn = adjustment.hue / 360;
  const vivid = 1 + adjustment.saturation / 100;
  const light = adjustment.brightness / 100;
  const keep = adjustment.opacity / 100;

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;

      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0;
      let s = 0;
      let l = (max + min) / 2;

      if (max !== min) {
        const spread = max - min;
        s = l > 0.5 ? spread / (2 - max - min) : spread / (max + min);

        if (max === r) h = (g - b) / spread + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / spread + 2;
        else h = (r - g) / spread + 4;

        h /= 6;
      }

      h = (((h + turn) % 1) + 1) % 1;
      s = Math.max(0, Math.min(1, s * vivid));
      l = light >= 0 ? l + (1 - l) * light : l + l * light;

      if (s === 0) {
        data[i] = data[i + 1] = data[i + 2] = l * 255;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;

        data[i] = hueToChannel(p, q, h + 1 / 3) * 255;
        data[i + 1] = hueToChannel(p, q, h) * 255;
        data[i + 2] = hueToChannel(p, q, h - 1 / 3) * 255;
      }

      data[i + 3] = data[i + 3]! * keep;
    }
  }
}

export function invert(pixels: Pixels, within?: Region | null): void {
  const region = clampRegion(pixels, within);

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * pixels.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = 255 - pixels.data[i + channel]!;
    }
  }
}

/** Removes the colour from an image, keeping how bright each pixel looks. */
export function greyscale(pixels: Pixels, within?: Region | null): void {
  const region = clampRegion(pixels, within);

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const i = (y * pixels.width + x) * 4;
      const grey = pixels.data[i]! * 0.299 + pixels.data[i + 1]! * 0.587 + pixels.data[i + 2]! * 0.114;

      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = grey;
    }
  }
}

/** Makes an area fully transparent. */
export function clear(pixels: Pixels, within?: Region | null): void {
  const region = clampRegion(pixels, within);

  for (let y = region.y; y < region.y + region.height; y++) {
    pixels.data.fill(0, (y * pixels.width + region.x) * 4, (y * pixels.width + region.x + region.width) * 4);
  }
}

/** The smallest rectangle holding everything which isn't fully transparent, or null for an empty image. */
export function contentBounds(pixels: Pixels): Region | null {
  let left = pixels.width;
  let top = pixels.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] === 0) continue;

      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
