import { type SliderBodyRequest, layoutSliderBody, paintSliderBody } from "./sliderBody";

/**
 * Draws slider bodies away from the page. A body takes dozens of wide strokes, which is enough to hold up a frame
 * or two of the preview each time a slider comes into view; drawn here, the preview never waits on one.
 */

export interface SliderBodyJob {
  id: number;
  /** Handed back with the result, so one drawn for a skin or a size since replaced can be told apart. */
  generation: number;
  request: SliderBodyRequest;
}

export interface SliderBodyResult {
  id: number;
  generation: number;
  bitmap: ImageBitmap;
  /** Top-left of the image in playfield coordinates. */
  x: number;
  y: number;
}

// Typed by hand: the page's own types and a worker's can't both be loaded, and this is all of a worker used here.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SliderBodyJob>) => void) | null;
  postMessage(message: SliderBodyResult, transfer: Transferable[]): void;
};

scope.onmessage = ({ data: { id, generation, request } }) => {
  const layout = layoutSliderBody(request);
  const canvas = new OffscreenCanvas(layout.width, layout.height);

  paintSliderBody(canvas.getContext("2d")!, request, layout);

  // Taking the bitmap is what makes the drawing happen, so it happens here and not in the page.
  const bitmap = canvas.transferToImageBitmap();

  scope.postMessage({ id, generation, bitmap, x: layout.x, y: layout.y }, [bitmap]);
};
