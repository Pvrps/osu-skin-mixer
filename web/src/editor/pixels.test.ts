import { describe, expect, it } from "vitest";
import { type Pixels, type Rgba, adjust, clear, contentBounds, floodFill, pixelAt, replaceColour } from "./pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const NONE: Rgba = [0, 0, 0, 0];

/** Builds an image from rows of letters: r(ed), b(lue), d(ark red), and anything else for transparent. */
function image(...rows: string[]): Pixels {
  const colours: Record<string, Rgba> = { r: RED, b: BLUE, d: [200, 0, 0, 255] };
  const data = new Uint8ClampedArray(rows.length * rows[0]!.length * 4);

  rows.forEach((row, y) => [...row].forEach((letter, x) => data.set(colours[letter] ?? NONE, (y * row.length + x) * 4)));

  return { data, width: rows[0]!.length, height: rows.length };
}

const letters = (pixels: Pixels) =>
  Array.from({ length: pixels.height }, (_, y) =>
    Array.from({ length: pixels.width }, (_, x) => {
      const [r, , b, a] = pixelAt(pixels, x, y);
      return a === 0 ? "." : b > 0 ? "b" : r === 255 ? "r" : "d";
    }).join(""),
  );

describe("floodFill", () => {
  it("stops at other colours, and doesn't cross them to reach more of the same", () => {
    const pixels = image("rr.r", "r..r", "...r");

    expect(floodFill(pixels, 0, 0, BLUE, 0, true)).toBe(true);
    expect(letters(pixels)).toEqual(["bb.r", "b..r", "...r"]);
  });

  it("fills every matching pixel when not contiguous, and takes in near colours with tolerance", () => {
    const pixels = image("rd.r", "....");

    floodFill(pixels, 0, 0, BLUE, 0, false);
    expect(letters(pixels)).toEqual(["bd.b", "...."]);

    const near = image("rd.r");
    floodFill(near, 0, 0, BLUE, 30, false);
    expect(letters(near)).toEqual(["bb.b"]);
  });

  it("fills transparent areas, and stays inside a selection", () => {
    const pixels = image("....", "....");

    floodFill(pixels, 0, 0, RED, 0, true, { x: 0, y: 0, width: 2, height: 1 });
    expect(letters(pixels)).toEqual(["rr..", "...."]);
  });

  it("says when nothing changed", () => {
    expect(floodFill(image("rr"), 0, 0, RED, 0, true)).toBe(false);
  });
});

describe("replaceColour", () => {
  it("moves a colour and its shades over to another, leaving the rest", () => {
    const pixels = image("rdb.");

    expect(replaceColour(pixels, RED, [0, 255, 0], 30)).toBe(true);

    expect(pixelAt(pixels, 0, 0)).toEqual([0, 255, 0, 255]);
    // The darker red was 55 short of the red picked, so it ends up as far short of the new colour.
    expect(pixelAt(pixels, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(pixels, 2, 0)).toEqual(BLUE);
    expect(pixelAt(pixels, 3, 0)).toEqual(NONE);
  });

  it("keeps a shade's distance from the new colour", () => {
    const pixels = image("d");

    replaceColour(pixels, RED, [255, 255, 255], 30);
    expect(pixelAt(pixels, 0, 0)).toEqual([200, 255, 255, 255]);
  });
});

describe("adjust", () => {
  it("turns hues, and leaves an image alone when nothing is asked of it", () => {
    const pixels = image("rb");

    adjust(pixels, { hue: 0, saturation: 0, brightness: 0, opacity: 100 });
    expect(letters(pixels)).toEqual(["rb"]);

    adjust(pixels, { hue: 120, saturation: 0, brightness: 0, opacity: 50 });
    expect(pixelAt(pixels, 0, 0)).toEqual([0, 255, 0, 128]);
  });

  it("drains colour and darkens", () => {
    const pixels = image("r");

    adjust(pixels, { hue: 0, saturation: -100, brightness: 0, opacity: 100 });
    expect(pixelAt(pixels, 0, 0)).toEqual([128, 128, 128, 255]);

    adjust(pixels, { hue: 0, saturation: 0, brightness: -100, opacity: 100 });
    expect(pixelAt(pixels, 0, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe("clear and contentBounds", () => {
  it("finds what is left after part of an image is cleared", () => {
    const pixels = image("rrrr", "rrrr", "rrrr");

    expect(contentBounds(pixels)).toEqual({ x: 0, y: 0, width: 4, height: 3 });

    clear(pixels, { x: 0, y: 0, width: 4, height: 1 });
    clear(pixels, { x: 3, y: 0, width: 1, height: 3 });
    expect(contentBounds(pixels)).toEqual({ x: 0, y: 1, width: 3, height: 2 });

    clear(pixels);
    expect(contentBounds(pixels)).toBeNull();
  });
});
