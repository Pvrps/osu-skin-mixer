import { Assets, type Texture } from "pixi.js";
import { type IniSection, iniValue, parseBool, parseColour, parseVersion } from "../lib/ini";
import { AUDIO_EXTS, IMAGE_EXTS, type Skin, type SkinFile, fileUrl, findIni, fontPrefix } from "../lib/skins";

/** A loaded texture plus the size it should be treated as having (`@2x` textures are half their pixel size). */
export interface Tex {
  texture: Texture;
  width: number;
  height: number;
  /** Multiplier taking texture pixels to logical pixels. */
  ratio: number;
  fromDefault: boolean;
}

interface Located {
  url: string;
  ratio: number;
  fromDefault: boolean;
}

const textureCache = new Map<string, Promise<Texture | null>>();

function loadTexture(url: string): Promise<Texture | null> {
  let pending = textureCache.get(url);

  if (!pending) {
    // Files are served by content hash, so a URL always means the same pixels and can be cached for good.
    pending = Assets.load<Texture>({ src: url, parser: "texture" }).catch(() => null);
    textureCache.set(url, pending);
  }

  return pending;
}

export type Rgb = [number, number, number];

// lazer's fallback combo colours for skins which define none.
const DEFAULT_COMBO_COLOURS: Rgb[] = [
  [255, 192, 0],
  [0, 202, 0],
  [18, 124, 255],
  [242, 24, 57],
];

/**
 * Resolves elements for the preview the way lazer does for a legacy skin: `@2x` first, then the plain file,
 * then the built-in classic skin for anything the skin leaves out.
 */
export class PreviewSkin {
  readonly ini: IniSection[];
  readonly version: number;

  private readonly images = new Map<string, { sd?: SkinFile; hd?: SkinFile }>();
  private readonly audio = new Map<string, SkinFile>();
  private readonly loaded = new Map<string, Tex | null>();
  private readonly loadedFrames = new Map<string, Tex[]>();

  constructor(
    skin: Skin,
    private readonly defaults: Set<string>,
  ) {
    this.ini = skin.ini;

    // Without any skin.ini lazer assumes the latest version; with one, a missing version means 1.0.
    this.version = findIni(skin.files) || skin.ini.length > 0 ? parseVersion(iniValue(skin.ini, "General", "Version")) : parseVersion("latest");

    for (const file of skin.files) {
      if (IMAGE_EXTS.has(file.ext)) {
        const entry = this.images.get(file.stem) ?? {};
        if (file.hd) entry.hd = file;
        else entry.sd = file;
        this.images.set(file.stem, entry);
      } else if (AUDIO_EXTS.has(file.ext) && !this.audio.has(file.stem)) {
        this.audio.set(file.stem, file);
      }
    }
  }

  /** Whether the skin itself (not the fallback) provides a texture. */
  has(name: string): boolean {
    return this.images.has(name.toLowerCase());
  }

  private locateOwn(name: string): Located | null {
    const entry = this.images.get(name.toLowerCase());
    if (!entry) return null;

    if (entry.hd) return { url: fileUrl(entry.hd), ratio: 0.5, fromDefault: false };
    return { url: fileUrl(entry.sd!), ratio: 1, fromDefault: false };
  }

  private locateDefault(name: string): Located | null {
    if (this.defaults.has(`${name}@2x.png`)) return { url: `/api/default/file/${name}@2x.png`, ratio: 0.5, fromDefault: true };
    if (this.defaults.has(`${name}.png`)) return { url: `/api/default/file/${name}.png`, ratio: 1, fromDefault: true };

    return null;
  }

  private async fetch(located: Located | null): Promise<Tex | null> {
    if (!located) return null;

    const texture = await loadTexture(located.url);
    if (!texture) return null;

    return {
      texture,
      width: texture.width * located.ratio,
      height: texture.height * located.ratio,
      ratio: located.ratio,
      fromDefault: located.fromDefault,
    };
  }

  /** Loads a single texture. `fallback` controls whether the classic skin may stand in for a missing one. */
  async load(name: string, fallback = true): Promise<void> {
    const key = `${name}|${fallback}`;
    if (this.loaded.has(key)) return;

    this.loaded.set(key, await this.fetch(this.locateOwn(name) ?? (fallback ? this.locateDefault(name) : null)));
  }

  /**
   * Loads an element which may be animated (`name-0`, `name-1`, ...).
   * As in lazer, whichever source provides either form supplies all of it.
   */
  async loadFrames(name: string, separator = "-"): Promise<void> {
    const key = `${name}|${separator}`;
    if (this.loadedFrames.has(key)) return;

    const own = this.has(`${name}${separator}0`) || this.has(name);
    const locate = own ? (n: string) => this.locateOwn(n) : (n: string) => this.locateDefault(n);

    const frames: Tex[] = [];

    for (let i = 0; i < 240; i++) {
      const frame = await this.fetch(locate(`${name}${separator}${i}`));
      if (!frame) break;

      frames.push(frame);
    }

    if (frames.length === 0) {
      const single = await this.fetch(locate(name));
      if (single) frames.push(single);
    }

    this.loadedFrames.set(key, frames);
  }

  tex(name: string, fallback = true): Tex | null {
    return this.loaded.get(`${name}|${fallback}`) ?? null;
  }

  frames(name: string, separator = "-"): Tex[] {
    return this.loadedFrames.get(`${name}|${separator}`) ?? [];
  }

  fontPrefix(key: string, fallback: string): string {
    return fontPrefix(this.ini, key, fallback);
  }

  /** Whether the skin provides its own glyphs for a font. If not, the classic skin's font is used wholesale. */
  hasFont(prefix: string): boolean {
    return this.has(`${prefix}-0`);
  }

  number(section: string, key: string, fallback: number): number {
    const value = Number.parseFloat(iniValue(this.ini, section, key) ?? "");
    return Number.isFinite(value) ? value : fallback;
  }

  bool(key: string, fallback: boolean): boolean {
    return parseBool(iniValue(this.ini, "General", key)) ?? fallback;
  }

  colour(key: string): Rgb | null {
    return parseColour(iniValue(this.ini, "Colours", key));
  }

  comboColours(): Rgb[] {
    const colours: Rgb[] = [];

    for (let i = 1; i <= 8; i++) {
      const colour = this.colour(`Combo${i}`);
      if (colour) colours.push(colour);
    }

    return colours.length > 0 ? colours : DEFAULT_COMBO_COLOURS;
  }

  /** The URL of the first of the given samples that exists, falling back to the classic skin. */
  sampleUrl(...names: string[]): string | null {
    for (const name of names) {
      const own = this.audio.get(name);
      if (own) return fileUrl(own);
    }

    for (const name of names) {
      for (const ext of ["wav", "ogg", "mp3"]) {
        if (this.defaults.has(`${name}.${ext}`)) return `/api/default/file/${name}.${ext}`;
      }
    }

    return null;
  }
}

export const rgbToHex = ([r, g, b]: Rgb) => (r << 16) | (g << 8) | b;
