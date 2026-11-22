import type { Rgb } from "./assets";
import { OBJECT_RADIUS, type Point } from "./scene";

/** Everything it takes to draw one slider's body. Plain data, so it can be handed to a worker. */
export interface SliderBodyRequest {
  path: Point[];
  objectScale: number;
  /** Image pixels per playfield unit. */
  pixelsPerUnit: number;
  border: Rgb;
  accent: Rgb;
}

/** Where a slider's body sits, and how large an image it takes. */
export interface SliderBodyLayout {
  /** Top-left of the image in playfield coordinates. */
  x: number;
  y: number;
  /** Size of the image in its own pixels. */
  width: number;
  height: number;
}

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// The visible body of a legacy slider is slightly narrower than a hit circle; the remainder is a soft shadow.
const LEGACY_CIRCLE_RADIUS = OBJECT_RADIUS - 5;
const SHADOW_PORTION = 1 - LEGACY_CIRCLE_RADIUS / OBJECT_RADIUS;
const BORDER_PORTION = 0.1875;
const BODY_ALPHA = 0.7;

type Rgba = [number, number, number, number];

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

/** The colour of a legacy slider at a distance from its edge (0) to its centre line (1), as in LegacySliderBody. */
function colourAt(position: number, border: Rgb, accent: Rgb): Rgba {
  if (position <= SHADOW_PORTION) return mix([0, 0, 0, 0], [0, 0, 0, 0.25], position / SHADOW_PORTION);
  if (position <= BORDER_PORTION) return [border[0], border[1], border[2], 1];

  const outer: Rgba = [accent[0] / 1.1, accent[1] / 1.1, accent[2] / 1.1, BODY_ALPHA];

  // lazer's "lighten", which is kinder to dark and saturated colours than a plain blend to white.
  const amount = 0.25;
  const lighten = (c: number) => Math.min(255, c * (1 + 0.5 * amount) + 255 * amount);
  const inner: Rgba = [lighten(accent[0]), lighten(accent[1]), lighten(accent[2]), BODY_ALPHA];

  return mix(outer, inner, (position - BORDER_PORTION) / (1 - BORDER_PORTION));
}

/**
 * Draws a slider body by stroking its path in ever narrower bands, each replacing what lies beneath it, so every
 * pixel ends up coloured by its distance from the centre line.
 */
export function paintSliderBody(context: Context, { path, objectScale, pixelsPerUnit, border, accent }: SliderBodyRequest, { x, y }: SliderBodyLayout) {
  const radius = OBJECT_RADIUS * objectScale;

  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();
  path.forEach((p, i) => {
    const px = (p.x - x) * pixelsPerUnit;
    const py = (p.y - y) * pixelsPerUnit;

    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });

  const bands: number[] = [];

  for (let i = 0; i < 5; i++) bands.push((i / 5) * SHADOW_PORTION);
  bands.push(SHADOW_PORTION + 1e-4);

  const bodySteps = 28;
  for (let i = 0; i < bodySteps; i++) bands.push(BORDER_PORTION + 1e-4 + (i / bodySteps) * (1 - BORDER_PORTION));

  bands.forEach((position, i) => {
    // Colour each band by its midpoint so the gradient isn't biased towards the outside.
    const next = bands[i + 1] ?? 1;
    const [r, g, b, a] = colourAt(Math.min(1, (position + next) / 2), border, accent);

    context.lineWidth = Math.max(0.5, 2 * radius * (1 - position) * pixelsPerUnit);

    context.globalCompositeOperation = "destination-out";
    context.strokeStyle = "#000";
    context.stroke();

    context.globalCompositeOperation = "source-over";
    context.strokeStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
    context.stroke();
  });
}

/** The image a slider's body needs: large enough for its path and the width of the body around it. */
export function layoutSliderBody({ path, objectScale, pixelsPerUnit }: SliderBodyRequest): SliderBodyLayout {
  const pad = OBJECT_RADIUS * objectScale + 2;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const p of path) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }

  const x = left - pad;
  const y = top - pad;

  return {
    x,
    y,
    width: Math.max(1, Math.ceil((right + pad - x) * pixelsPerUnit)),
    height: Math.max(1, Math.ceil((bottom + pad - y) * pixelsPerUnit)),
  };
}

/** Draws a slider's body here and now, for browsers which can't have it drawn in the background. */
export function renderSliderBody(request: SliderBodyRequest): SliderBodyLayout & { canvas: HTMLCanvasElement } {
  const layout = layoutSliderBody(request);
  const canvas = document.createElement("canvas");

  canvas.width = layout.width;
  canvas.height = layout.height;
  paintSliderBody(canvas.getContext("2d")!, request, layout);

  return { ...layout, canvas };
}
