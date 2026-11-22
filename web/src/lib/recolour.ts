import { fileUrl } from "./skins";

/**
 * How an image is recoloured.
 *
 * - `tint` paints the whole image in one colour, keeping only how bright each pixel was. A white or grey image
 *   comes out in exactly the chosen colour.
 * - `hue` only moves the image's colours to the chosen hue, so its whites, greys and shading stay as they were.
 */
export type RecolourMode = "tint" | "hue";

export interface Recolour {
  /** `#rrggbb` */
  colour: string;
  mode: RecolourMode;
}

export const isRecolour = (value: unknown): value is Recolour => {
  const r = value as Recolour | null;
  return typeof r === "object" && r !== null && typeof r.colour === "string" && /^#[0-9a-f]{6}$/i.test(r.colour) && (r.mode === "tint" || r.mode === "hue");
};

/** Identifies one recoloured image: the same source and settings always give the same key. */
export const recolourKey = (hash: string, recolour: Recolour) => `${hash}-${recolour.mode}-${recolour.colour.slice(1).toLowerCase()}`;

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  if (delta === 0) return 0;

  if (max === r) return (((g - b) / delta) % 6 + 6) % 6;
  if (max === g) return (b - r) / delta + 2;

  return (r - g) / delta + 4;
}

/** Recolours RGBA pixels in place. Transparency is never touched. */
export function recolourPixels(pixels: Uint8ClampedArray, recolour: Recolour): void {
  const target = [1, 3, 5].map((i) => parseInt(recolour.colour.slice(i, i + 2), 16)) as [number, number, number];
  const targetHue = hueOf(...target);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const max = Math.max(r, g, b);

    if (recolour.mode === "tint") {
      pixels[i] = (target[0] * max) / 255;
      pixels[i + 1] = (target[1] * max) / 255;
      pixels[i + 2] = (target[2] * max) / 255;
      continue;
    }

    // Rebuild the pixel at the new hue with its own saturation and brightness.
    const chroma = max - Math.min(r, g, b);
    const x = chroma * (1 - Math.abs((targetHue % 2) - 1));
    const floor = max - chroma;
    const sector = Math.floor(targetHue) % 6;
    const [nr, ng, nb] = [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ][sector] as [number, number, number];

    pixels[i] = nr + floor;
    pixels[i + 1] = ng + floor;
    pixels[i + 2] = nb + floor;
  }
}

async function render(file: { name: string; hash: string }, recolour: Recolour): Promise<Blob> {
  const response = await fetch(fileUrl(file));
  if (!response.ok) throw new Error(`Couldn't read ${file.name} to recolour it.`);

  const image = await createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);

  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  recolourPixels(data.data, recolour);
  context.putImageData(data, 0, 0);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`Couldn't recolour ${file.name}.`))), "image/png"));
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Makes the recoloured version of an image and hands it to the server, returning the hash it can be used under.
 * Images which were made before are reused, so a mix resolves to the same files every time.
 */
export function generateRecolour(file: { name: string; hash: string }, recolour: Recolour): Promise<string> {
  const key = recolourKey(file.hash, recolour);
  let promise = inFlight.get(key);

  if (!promise) {
    promise = (async () => {
      const existing = await fetch(`/api/generated/${key}`);
      if (existing.ok) return ((await existing.json()) as { hash: string }).hash;

      const saved = await fetch(`/api/generated/${key}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: await render(file, recolour) });
      if (!saved.ok) throw new Error(`Couldn't save the recoloured ${file.name}.`);

      return ((await saved.json()) as { hash: string }).hash;
    })();

    inFlight.set(key, promise);
  }

  return promise;
}
