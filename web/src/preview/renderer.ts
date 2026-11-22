import { Application, Assets, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Skin } from "../lib/skins";
import { PreviewSkin, type Rgb, type Tex, rgbToHex } from "./assets";
import { PreviewAudio } from "./audio";
import {
  DEMO_SCENE,
  MISS_DELAY,
  OBJECT_RADIUS,
  PLAYFIELD,
  type Point,
  type Scene,
  type SceneObject,
  type SliderObject,
  type SpinnerObject,
  ballAt,
  endPosition,
  endTime,
  judgementTime,
  pathAt,
  spinRotation,
  startPosition,
} from "./scene";
import { renderSliderBody } from "./sliderBody";

interface DrawOptions {
  scale?: number;
  scaleX?: number;
  rotation?: number;
  alpha?: number;
  tint?: number;
  additive?: boolean;
  anchorX?: number;
  anchorY?: number;
}

interface Font {
  glyphs: Map<string, Tex>;
  overlap: number;
}

type FontName = "hitcircle" | "score" | "combo";

const GLYPH_NAMES: Record<string, string> = { ",": "comma", ".": "dot", "%": "percent", x: "x" };
for (let i = 0; i < 10; i++) GLYPH_NAMES[String(i)] = String(i);

const FONT_SPECS: Record<FontName, { prefixKey: string; overlapKey: string; fallback: string; chars: string }> = {
  hitcircle: { prefixKey: "HitCirclePrefix", overlapKey: "HitCircleOverlap", fallback: "default", chars: "0123456789" },
  score: { prefixKey: "ScorePrefix", overlapKey: "ScoreOverlap", fallback: "score", chars: "0123456789,.%x" },
  combo: { prefixKey: "ComboPrefix", overlapKey: "ComboOverlap", fallback: "score", chars: "0123456789,.%x" },
};

const SINGLE_TEXTURES = [
  "approachcircle",
  "sliderb-nd",
  "sliderb-spec",
  "sliderscorepoint",
  "reversearrow",
  "cursor",
  "cursormiddle",
  "cursortrail",
  "inputoverlay-background",
  "inputoverlay-key",
  "scorebar-bg",
  "scorebar-marker",
  "scorebar-ki",
  "scorebar-kidanger",
  "scorebar-kidanger2",
  "spinner-glow",
  "spinner-bottom",
  "spinner-top",
  "spinner-middle",
  "spinner-middle2",
  "spinner-background",
  "spinner-circle",
  "spinner-metre",
  "spinner-approachcircle",
  "spinner-spin",
  "spinner-clear",
  "spinner-rpm",
  "particle300",
  "particle100",
  "particle50",
];

const ANIMATED_TEXTURES = ["hit0", "hit50", "hit100", "hit300", "followpoint", "sliderfollowcircle", "scorebar-colour"];

const HEALTH_TEXTURES = ["scorebar-bg", "scorebar-marker", "scorebar-ki", "scorebar-kidanger", "scorebar-kidanger2"];

// The key overlay shows two keyboard keys and two mouse buttons, lit in a colour of their own while held.
const KEY_NAMES = ["K1", "K2", "M1", "M2"];
const KEY_ACTIVE_COLOURS = [0xffde00, 0xffde00, 0xf8009e, 0xf8009e];
const KEY_SIZE = 46;
const KEY_TRANSITION = 160;

const RESULT_TEXTURE = { great: "hit300", ok: "hit100", meh: "hit50", miss: "hit0" } as const;
const RESULT_PARTICLE = { great: "particle300", ok: "particle100", meh: "particle50", miss: null } as const;

// Sizes are expressed against lazer's two coordinate systems: the 640x480 "stable" space gameplay lives in, and
// the 1024x768 space HUD elements, the cursor and the spinner are laid out in.
const STABLE_HEIGHT = 480;
const UI_HEIGHT = 768;

const HIT_FADE = 240;
const JUDGEMENT_FADE_IN = 120;
const JUDGEMENT_FADE_OUT_DELAY = 500;
const JUDGEMENT_FADE_OUT = 600;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);
const inQuad = (t: number) => t * t;

/** Scale factor keeping a texture within a maximum size, as lazer's WithMaximumSize does. */
const fit = (tex: Tex, max: number) => Math.min(1, max / tex.width, max / tex.height);

export interface PreviewSettings {
  /** How much of the background shows through, from 0 (black) to 1. */
  backdrop: number;
  playing: boolean;
  sound: boolean;
  /** 0 to 1. */
  volume: number;
  hud: boolean;
}

/** What goes with a scene: the song it is set to and the picture behind it. */
export interface SceneMedia {
  audioUrl: string | null;
  backgroundUrl: string | null;
}

/** How long a slider's body is kept after it was last drawn. */
const SLIDER_BODY_LIFETIME = 3000;

export class PreviewRenderer {
  private readonly app = new Application();
  private readonly stage = new Container();
  private readonly pool: Sprite[] = [];
  private used = 0;

  private readonly audio = new PreviewAudio();

  private skin: PreviewSkin | null = null;
  /** The game's own skin, for the things which are taken whole from one skin or the other. */
  private builtIn: PreviewSkin | null = null;
  private readonly labels = new Map<string, Tex>();
  private fonts: Record<FontName, Font> | null = null;
  private comboColours: Rgb[] = [];
  private trailConnected = false;
  private trailFade = 150;
  private trailSpacing = 1;

  private scene: Scene = DEMO_SCENE;
  private readonly background = new Sprite();
  private backgroundGeneration = 0;

  /** Called a few times a second with the current time, for whatever shows playback progress. */
  onProgress: ((time: number) => void) | null = null;
  private lastProgress = 0;

  private sliderBodies = new Map<number, Tex & { x: number; y: number; usedAt: number }>();
  private lastSweep = 0;
  private readonly cropped = new Map<string, Texture>();
  private skinGeneration = 0;

  private width = 1;
  private height = 1;
  private time = 0;
  private displayedHealth = 1;
  private settings: PreviewSettings = { backdrop: 0.12, playing: true, sound: false, volume: 0.6, hud: true };

  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private ready = false;

  async init(host: HTMLElement) {
    await this.app.init({
      width: host.clientWidth || 640,
      height: host.clientHeight || 360,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      background: 0x000000,
    });

    if (this.destroyed) {
      this.app.destroy({ removeView: true }, { children: true });
      return;
    }

    this.ready = true;
    host.appendChild(this.app.canvas);
    this.background.anchor.set(0.5);
    this.app.stage.addChild(this.background);
    this.app.stage.addChild(this.stage);

    this.resize(host.clientWidth, host.clientHeight);
    this.resizeObserver = new ResizeObserver(() => this.resize(host.clientWidth, host.clientHeight));
    this.resizeObserver.observe(host);

    this.app.ticker.add((ticker) => this.frame(ticker.deltaMS));
    this.applyBackdrop();
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.audio.destroy();

    if (this.ready) {
      this.clearGenerated();
      this.app.destroy({ removeView: true }, { children: true });
    }
  }

  setSettings(settings: PreviewSettings) {
    const soundChanged = settings.sound !== this.settings.sound;
    this.settings = settings;
    this.applyBackdrop();

    this.audio.setVolume(settings.volume);

    if (soundChanged) {
      if (settings.sound) this.audio.enable();
      else this.audio.disable();
    }

    this.audio.syncMusic(settings.playing, this.time);
  }

  /** Jumps to a point in the scene. */
  seek(time: number) {
    this.time = Math.max(this.scene.start, Math.min(this.scene.end - 1, time));
    this.displayedHealth = this.scene.hudAt(this.time).health;
    this.audio.seekMusic(this.time);
    this.onProgress?.(this.time);
  }

  get currentTime() {
    return this.time;
  }

  /** Whether sound is on but won't be heard until the page has been clicked. */
  get soundWaitingForClick() {
    return this.audio.waitingForClick;
  }

  /** Switches to a different set of hit objects, starting from the given time. */
  setScene(scene: Scene, media: SceneMedia, startAt: number) {
    this.scene = scene;
    this.clearGenerated();
    this.configureTrail();

    this.audio.setMusic(media.audioUrl);
    this.seek(startAt);
    this.audio.syncMusic(this.settings.playing, this.time);

    const generation = ++this.backgroundGeneration;

    // Without a picture of its own, a scene gets a backdrop drawn here, so skins are never judged against flat grey.
    this.background.texture = this.backdrop();
    this.background.visible = true;
    this.applyBackdrop();

    if (media.backgroundUrl) {
      void Assets.load<Texture>({ src: media.backgroundUrl, parser: "texture" })
        .then((texture) => {
          if (generation !== this.backgroundGeneration || this.destroyed) return;

          this.background.texture = texture;
          this.background.visible = true;
          this.applyBackdrop();
        })
        .catch(() => {});
    }
  }

  private fallbackBackdrop: Texture | null = null;

  /** A soft, dark wash of colour, in the spirit of a beatmap background without being one. */
  private backdrop(): Texture {
    if (!this.fallbackBackdrop) {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;

      const context = canvas.getContext("2d")!;
      const base = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      base.addColorStop(0, "#2a1746");
      base.addColorStop(0.55, "#1a1838");
      base.addColorStop(1, "#0f2238");
      context.fillStyle = base;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const glows: [x: number, y: number, radius: number, colour: string][] = [
        [240, 160, 520, "255, 102, 171"],
        [1040, 240, 560, "140, 102, 255"],
        [760, 660, 520, "70, 190, 255"],
      ];

      for (const [x, y, radius, colour] of glows) {
        const glow = context.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(${colour}, 0.55)`);
        glow.addColorStop(1, `rgba(${colour}, 0)`);
        context.fillStyle = glow;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      this.fallbackBackdrop = Texture.from(canvas);
    }

    return this.fallbackBackdrop;
  }

  private applyBackdrop() {
    if (!this.ready) return;

    const level = clamp01(this.settings.backdrop);

    if (this.background.visible) {
      // The picture covers the whole preview, however either of them is shaped.
      const texture = this.background.texture;
      const scale = Math.max(this.width / texture.width, this.height / texture.height);

      this.background.scale.set(scale);
      this.background.position.set(this.width / 2, this.height / 2);
      this.background.alpha = level;
      this.app.renderer.background.color = 0x000000;
      return;
    }

    const grey = Math.round(level * 0.6 * 255);
    this.app.renderer.background.color = (grey << 16) | (grey << 8) | grey;
  }

  /** Switches the preview to a different skin once all of its textures have loaded. */
  async setSkin(source: Skin, defaults: Set<string>) {
    const generation = ++this.skinGeneration;
    const skin = new PreviewSkin(source, defaults);

    const fontPrefixes = {} as Record<FontName, { prefix: string; own: boolean }>;
    const loads: Promise<void>[] = [];

    for (const name of SINGLE_TEXTURES) loads.push(skin.load(name));
    for (const name of ANIMATED_TEXTURES) loads.push(skin.loadFrames(name));

    const builtIn = new PreviewSkin({ id: "built-in", name: "", creator: "", files: [], ini: [] }, defaults);

    for (const name of HEALTH_TEXTURES) loads.push(builtIn.load(name));
    loads.push(builtIn.loadFrames("scorebar-colour"));

    loads.push(skin.loadFrames("sliderb", ""));

    // Circle pieces: a skin's own slider start/end circles replace the regular circle, overlay included.
    for (const name of ["hitcircle", "sliderstartcircle", "sliderendcircle"]) {
      loads.push(skin.load(name, name === "hitcircle"));
      loads.push(skin.loadFrames(`${name}overlay`));
    }

    for (const font of Object.keys(FONT_SPECS) as FontName[]) {
      const spec = FONT_SPECS[font];
      const ownPrefix = skin.fontPrefix(spec.prefixKey, spec.fallback);
      const own = skin.hasFont(ownPrefix);

      // A skin without glyphs for a font gets the classic skin's font in full.
      fontPrefixes[font] = { prefix: own ? ownPrefix : spec.fallback, own };

      for (const char of spec.chars) loads.push(skin.load(`${fontPrefixes[font].prefix}-${GLYPH_NAMES[char]}`, !own));
    }

    await Promise.all(loads);

    if (generation !== this.skinGeneration || this.destroyed) return;

    this.audio.setSkin(skin);

    const fonts = {} as Record<FontName, Font>;

    for (const font of Object.keys(FONT_SPECS) as FontName[]) {
      const spec = FONT_SPECS[font];
      const { prefix, own } = fontPrefixes[font];
      const glyphs = new Map<string, Tex>();

      for (const char of spec.chars) {
        const tex = skin.tex(`${prefix}-${GLYPH_NAMES[char]}`, !own);
        if (tex) glyphs.set(char, tex);
      }

      fonts[font] = { glyphs, overlap: own ? skin.number("Fonts", spec.overlapKey, -2) : -2 };
    }

    this.skin = skin;
    this.builtIn = builtIn;
    this.fonts = fonts;
    this.comboColours = skin.comboColours();

    this.configureTrail();
    this.clearGenerated();
  }

  private configureTrail() {
    const skin = this.skin;
    const texture = skin?.tex("cursortrail");
    if (!skin || !texture) return;

    // As in lazer, a skin with a cursormiddle gets a dense, additive, slowly fading trail; without one the trail
    // is a sparse series of parts dropped at a fixed rate.
    this.trailConnected = skin.has("cursor") ? skin.has("cursormiddle") : skin.tex("cursormiddle") !== null;
    this.trailFade = this.trailConnected ? 500 : 150;
    this.trailSpacing = Math.max(0.5, (texture.width * STABLE_HEIGHT) / UI_HEIGHT / 2.5);
  }

  /** Drops textures generated for the current skin and size so they are rebuilt on demand. */
  private clearGenerated() {
    for (const body of this.sliderBodies.values()) body.texture.destroy(true);
    this.sliderBodies.clear();

    for (const texture of this.cropped.values()) texture.destroy(false);
    this.cropped.clear();
  }

  private resize(width: number, height: number) {
    if (!this.ready || width <= 0 || height <= 0) return;

    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.clearGenerated();
    this.applyBackdrop();
  }

  // ---- coordinate helpers -------------------------------------------------------------------------------------

  /** Size of one playfield unit in CSS pixels. */
  private get unit() {
    // The playfield area is 4:3 and always fits, whatever shape the preview is.
    return Math.min(this.height / STABLE_HEIGHT, this.width / 640);
  }

  /** Size of one HUD unit in CSS pixels. */
  private get hudUnit() {
    return (this.unit * STABLE_HEIGHT) / UI_HEIGHT;
  }

  private toScreen(p: Point): Point {
    const u = this.unit;

    return {
      x: (this.width - PLAYFIELD.width * u) / 2 + p.x * u,
      // lazer nudges the playfield down a touch to leave room for the HUD.
      y: (this.height - PLAYFIELD.height * u) / 2 + 8 * u + p.y * u,
    };
  }

  // ---- drawing primitives -------------------------------------------------------------------------------------

  private draw(tex: Tex | null | undefined, x: number, y: number, options: DrawOptions = {}) {
    if (!tex) return;

    const alpha = options.alpha ?? 1;
    if (alpha <= 0.001) return;

    let sprite = this.pool[this.used];

    if (!sprite) {
      sprite = new Sprite();
      this.pool.push(sprite);
      this.stage.addChild(sprite);
    }

    this.used++;

    const scale = (options.scale ?? 1) * tex.ratio;

    sprite.texture = tex.texture;
    sprite.visible = true;
    sprite.position.set(x, y);
    sprite.anchor.set(options.anchorX ?? 0.5, options.anchorY ?? 0.5);
    sprite.scale.set(scale * (options.scaleX ?? 1), scale);
    sprite.rotation = options.rotation ?? 0;
    sprite.alpha = Math.min(1, alpha);
    sprite.tint = options.tint ?? 0xffffff;
    sprite.blendMode = options.additive ? "add" : "normal";
  }

  /** A view of a texture limited to a fraction of its area, anchored at the left/bottom as requested. */
  private crop(tex: Tex, key: string, x0: number, y0: number, x1: number, y1: number): Tex {
    const quantise = (v: number) => Math.round(clamp01(v) * 256) / 256;
    const [qx0, qy0, qx1, qy1] = [quantise(x0), quantise(y0), quantise(x1), quantise(y1)];
    const cacheKey = `${key}:${tex.texture.uid}:${qx0}:${qy0}:${qx1}:${qy1}`;

    let texture = this.cropped.get(cacheKey);

    if (!texture) {
      const frame = tex.texture.frame;

      texture = new Texture({
        source: tex.texture.source,
        frame: new Rectangle(
          frame.x + frame.width * qx0,
          frame.y + frame.height * qy0,
          Math.max(1, frame.width * (qx1 - qx0)),
          Math.max(1, frame.height * (qy1 - qy0)),
        ),
      });
      this.cropped.set(cacheKey, texture);
    }

    return { ...tex, texture, width: tex.width * (qx1 - qx0), height: tex.height * (qy1 - qy0) };
  }

  private frameLength(count: number): number {
    const configured = this.skin?.number("General", "AnimationFramerate", -1) ?? -1;
    return configured > 0 ? 1000 / configured : 1000 / Math.max(1, count);
  }

  private frameAt(frames: Tex[], elapsed: number, loop: boolean): Tex | null {
    if (frames.length === 0) return null;
    if (frames.length === 1) return frames[0]!;

    const index = Math.floor(Math.max(0, elapsed) / this.frameLength(frames.length));
    return frames[loop ? index % frames.length : Math.min(frames.length - 1, index)]!;
  }

  private textWidth(font: Font, text: string, fixedWidth: boolean): number {
    const reference = font.glyphs.get("5");
    let width = 0;
    let count = 0;

    for (const char of text) {
      const glyph = font.glyphs.get(char);
      if (!glyph) continue;

      width += fixedWidth && reference && /\d/.test(char) ? reference.width : glyph.width;
      count++;
    }

    return width - font.overlap * Math.max(0, count - 1);
  }

  /** Draws text from a skin font. `x`/`y` position the text box according to the given anchors. */
  private drawText(
    fontName: FontName,
    text: string,
    x: number,
    y: number,
    options: { scale: number; anchorX: number; anchorY: number; fixedWidth?: boolean; alpha?: number; additive?: boolean },
  ): { width: number; height: number } {
    const font = this.fonts?.[fontName];
    if (!font) return { width: 0, height: 0 };

    const fixedWidth = options.fixedWidth ?? false;
    const reference = font.glyphs.get("5");
    const width = this.textWidth(font, text, fixedWidth);
    let height = 0;

    for (const char of text) height = Math.max(height, font.glyphs.get(char)?.height ?? 0);

    let cursor = x - width * options.scale * options.anchorX;
    const top = y - height * options.scale * options.anchorY;

    for (const char of text) {
      const glyph = font.glyphs.get(char);
      if (!glyph) continue;

      const advance = fixedWidth && reference && /\d/.test(char) ? reference.width : glyph.width;

      // Fixed-width digits are centred within their cell.
      this.draw(glyph, cursor + ((advance - glyph.width) / 2) * options.scale, top, {
        scale: options.scale,
        anchorX: 0,
        anchorY: 0,
        alpha: options.alpha,
        additive: options.additive,
      });

      cursor += (advance - font.overlap) * options.scale;
    }

    return { width: width * options.scale, height: height * options.scale };
  }

  // ---- frame --------------------------------------------------------------------------------------------------

  private frame(deltaMs: number) {
    const previous = this.time;
    const scene = this.scene;

    if (this.settings.playing) {
      this.time += Math.min(deltaMs, 100);

      // With the song playing, it keeps the time: ease towards it, or jump if the two have come apart.
      const music = this.audio.musicTime();

      if (music !== null) {
        const drift = music - this.time;
        this.time = Math.abs(drift) > 80 ? music : this.time + drift * 0.15;
      }

      if (this.time >= scene.end) {
        this.time = scene.start;
        this.audio.seekMusic(this.time);
      }

      this.audio.syncMusic(true, this.time);
    }

    const now = performance.now();

    if (now - this.lastProgress > 200) {
      this.lastProgress = now;
      this.onProgress?.(this.time);
    }

    this.used = 0;

    // Done between frames, while no sprite is showing one of them.
    if (this.labels.size > 300) {
      for (const label of this.labels.values()) label.texture.destroy(true);
      this.labels.clear();
    }

    if (this.skin) {
      this.playSounds(previous, this.time);
      this.drawScene(this.time);
    }

    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;

    if (now - this.lastSweep > 1000) {
      this.lastSweep = now;

      for (const [id, body] of this.sliderBodies) {
        if (now - body.usedAt > SLIDER_BODY_LIFETIME) {
          body.texture.destroy(true);
          this.sliderBodies.delete(id);
        }
      }
    }
  }

  private playSounds(from: number, to: number) {
    // Anything but a small step forwards is a seek or a restart, with nothing in between to be heard.
    if (!this.settings.sound || to <= from || to - from > 250) return;

    for (const event of this.scene.sounds) {
      if (event.time > to) break;
      if (event.time > from) this.audio.play(event.samples);
    }
  }

  /** The objects which could be on screen at a time, in order. Everything else is skipped without a look. */
  private visibleObjects(time: number): SceneObject[] {
    const objects = this.scene.objects;
    const linger = JUDGEMENT_FADE_OUT_DELAY + JUDGEMENT_FADE_OUT + MISS_DELAY;

    // Objects are in order of their start, so the last one which has appeared can be found by halving.
    let low = 0;
    let high = objects.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (objects[middle]!.time - this.scene.preempt <= time) low = middle + 1;
      else high = middle;
    }

    const visible: SceneObject[] = [];

    // Walking back from there, anything which ended long ago is done with. Long objects are few, so a generous
    // look behind is enough to catch one that started early and is still going.
    for (let i = low - 1; i >= 0 && visible.length < 400; i--) {
      const object = objects[i]!;

      if (endTime(object) + linger >= time) visible.push(object);
      else if (time - object.time > 120000) break;
    }

    return visible.reverse();
  }

  private drawScene(time: number) {
    this.drawFollowPoints(time);

    const OBJECTS = this.visibleObjects(time);

    // Earlier objects sit on top of later ones.
    for (let i = OBJECTS.length - 1; i >= 0; i--) {
      const object = OBJECTS[i]!;

      if (object.kind === "circle") {
        this.drawCirclePiece(time, object.position, {
          appear: object.time - this.scene.preempt,
          hitAt: object.result === "miss" ? null : object.time,
          missAt: object.result === "miss" ? object.time + MISS_DELAY : null,
          combo: object.combo,
          number: object.number,
          lookup: "hitcircle",
        });
      } else if (object.kind === "slider") {
        this.drawSlider(time, object);
      }
    }

    for (const object of OBJECTS) this.drawJudgement(time, object);

    for (const object of OBJECTS) {
      if (object.kind !== "spinner") this.drawApproachCircle(time, object);
    }

    for (const object of OBJECTS) {
      if (object.kind === "spinner") this.drawSpinner(time, object);
    }

    if (this.settings.hud) this.drawHud(time);

    this.drawCursor(time);
  }

  private comboColour(combo: number): number {
    return rgbToHex(this.comboColours[combo % this.comboColours.length] ?? [255, 255, 255]);
  }

  // ---- hit circles --------------------------------------------------------------------------------------------

  private drawCirclePiece(
    time: number,
    position: Point,
    piece: { appear: number; hitAt: number | null; missAt: number | null; combo: number; number: number | null; lookup: string },
  ) {
    const { fadeIn: FADE_IN, objectScale: OBJECT_SCALE } = this.scene;
    const skin = this.skin!;

    if (time < piece.appear) return;

    let alpha = clamp01((time - piece.appear) / FADE_IN);
    let scale = 1;
    let numberAlpha = alpha;
    let numberScale = 1;

    if (piece.hitAt !== null && time >= piece.hitAt) {
      const progress = (time - piece.hitAt) / HIT_FADE;
      if (progress >= 1) return;

      alpha = 1 - progress;
      scale = 1 + 0.4 * outQuad(progress);

      if (skin.version > 1) {
        // Newer skins make the number vanish almost immediately rather than expand with the circle.
        numberAlpha = 1 - clamp01((time - piece.hitAt) / (HIT_FADE / 4));
      } else {
        numberAlpha = alpha;
        numberScale = scale;
      }
    } else if (piece.missAt !== null && time >= piece.missAt) {
      const progress = (time - piece.missAt) / 100;
      if (progress >= 1) return;

      alpha *= 1 - progress;
      numberAlpha = alpha;
    }

    // A skin's own slider start/end circle replaces the regular circle, and then only its own overlay applies.
    const lookup = piece.lookup !== "hitcircle" && skin.has(piece.lookup) ? piece.lookup : "hitcircle";
    const circle = skin.tex(lookup, lookup === "hitcircle");
    const overlay = this.frameAt(skin.frames(`${lookup}overlay`), time - piece.appear, true);

    const { x, y } = this.toScreen(position);
    const base = OBJECT_SCALE * this.unit;
    const maxSize = OBJECT_RADIUS * 4;

    if (circle) this.draw(circle, x, y, { scale: base * scale * fit(circle, maxSize), alpha, tint: this.comboColour(piece.combo) });

    const drawOverlay = () => {
      if (overlay) this.draw(overlay, x, y, { scale: base * scale * fit(overlay, maxSize), alpha });
    };

    const drawNumber = () => {
      if (piece.number === null) return;

      // lazer applies a blanket 0.8x scale to hit circle numbers.
      this.drawText("hitcircle", String(piece.number), x, y, { scale: base * 0.8 * numberScale, anchorX: 0.5, anchorY: 0.5, alpha: numberAlpha });
    };

    const overlayAboveNumber = skin.bool("HitCircleOverlayAboveNumber", skin.bool("HitCircleOverlayAboveNumer", true));

    if (overlayAboveNumber) {
      drawNumber();
      drawOverlay();
    } else {
      drawOverlay();
      drawNumber();
    }
  }

  private drawApproachCircle(time: number, object: SceneObject) {
    const { preempt: PREEMPT, fadeIn: FADE_IN, objectScale: OBJECT_SCALE } = this.scene;
    const texture = this.skin!.tex("approachcircle");
    const appear = object.time - PREEMPT;

    if (!texture || time < appear) return;

    let alpha = 0.9 * clamp01((time - appear) / Math.min(FADE_IN * 2, PREEMPT));
    const scale = lerp(4, 1, clamp01((time - appear) / PREEMPT));

    if (time >= object.time) {
      const fade = (time - object.time) / 50;
      if (fade >= 1) return;

      alpha *= 1 - fade;
    }

    const { x, y } = this.toScreen(startPosition(object));

    this.draw(texture, x, y, {
      scale: OBJECT_SCALE * this.unit * scale * fit(texture, OBJECT_RADIUS * 4),
      alpha,
      tint: this.comboColour(object.combo),
    });
  }

  // ---- sliders ------------------------------------------------------------------------------------------------

  private sliderBody(slider: SliderObject): Tex & { x: number; y: number; usedAt: number } {
    let body = this.sliderBodies.get(slider.id);

    if (!body) {
      const skin = this.skin!;
      const resolution = this.app.renderer.resolution;
      const accent = skin.colour("SliderTrackOverride") ?? this.comboColours[slider.combo % this.comboColours.length] ?? [255, 255, 255];
      const image = renderSliderBody(slider, this.scene.objectScale, this.unit * resolution, skin.colour("SliderBorder") ?? [255, 255, 255], accent);
      const texture = Texture.from(image.canvas);

      body = { texture, width: image.canvas.width / resolution, height: image.canvas.height / resolution, ratio: 1 / resolution, fromDefault: false, x: image.x, y: image.y, usedAt: 0 };
      this.sliderBodies.set(slider.id, body);
    }

    return body;
  }

  private drawSlider(time: number, slider: SliderObject) {
    const { preempt: PREEMPT, fadeIn: FADE_IN, objectScale: OBJECT_SCALE } = this.scene;
    const skin = this.skin!;
    const appear = slider.time - PREEMPT;
    const end = endTime(slider);

    if (time < appear || time > end + HIT_FADE) return;

    const fadeIn = clamp01((time - appear) / FADE_IN);
    const fadeOut = time > end ? 1 - (time - end) / HIT_FADE : 1;
    const base = OBJECT_SCALE * this.unit;

    const body = this.sliderBody(slider);
    body.usedAt = performance.now();
    const bodyOrigin = this.toScreen(body);
    this.draw(body, bodyOrigin.x, bodyOrigin.y, { anchorX: 0, anchorY: 0, alpha: fadeIn * fadeOut });

    const firstArrival = slider.time + slider.spanDuration;

    // The far end of the path: a circle without a number, hit when the ball first reaches it.
    this.drawCirclePiece(time, pathAt(slider, 1), {
      appear,
      hitAt: firstArrival,
      missAt: null,
      combo: slider.combo,
      number: null,
      lookup: "sliderendcircle",
    });

    const tick = skin.tex("sliderscorepoint");

    if (tick) {
      for (const fraction of slider.ticks) {
        // A tick stays until the ball passes over it for the last time.
        const lastSpan = slider.spans - 1;
        const lastPass = slider.time + lastSpan * slider.spanDuration + (lastSpan % 2 === 0 ? fraction : 1 - fraction) * slider.spanDuration;

        if (time >= lastPass) continue;

        const { x, y } = this.toScreen(pathAt(slider, fraction));
        this.draw(tick, x, y, { scale: base * fit(tick, OBJECT_RADIUS * 2), alpha: fadeIn });
      }
    }

    if (slider.spans > 1) this.drawReverseArrow(time, slider, appear, firstArrival);

    this.drawCirclePiece(time, slider.path[0]!, {
      appear,
      hitAt: slider.time,
      missAt: null,
      combo: slider.combo,
      number: slider.number,
      lookup: "sliderstartcircle",
    });

    if (time >= slider.time) this.drawSliderBall(time, slider, end);
  }

  private drawReverseArrow(time: number, slider: SliderObject, appear: number, hitAt: number) {
    const { objectScale: OBJECT_SCALE } = this.scene;
    const skin = this.skin!;
    const arrow = skin.tex("reversearrow");
    if (!arrow) return;

    const tip = slider.path[slider.path.length - 1]!;
    const before = slider.path[slider.path.length - 2]!;
    const rotation = Math.atan2(before.y - tip.y, before.x - tip.x);

    let alpha = clamp01((time - appear) / 150);
    let scale: number;

    if (time >= hitAt) {
      const duration = Math.min(300, slider.spanDuration);
      const progress = (time - hitAt) / duration;
      if (progress >= 1) return;

      alpha = 1 - progress;
      scale = lerp(1, 1.4, outQuad(progress));
    } else {
      const loop = (((time - appear) % 300) + 300) % 300 / 300;

      // Older skins pulse linearly, newer ones ease out.
      scale = lerp(1.3, 1, skin.version <= 1 ? loop : outQuad(loop));
    }

    const { x, y } = this.toScreen(tip);

    // The classic skin's arrow is tinted dark on bright combo colours so it stays visible.
    const [r, g, b] = this.comboColours[slider.combo % this.comboColours.length] ?? [0, 0, 0];
    const tint = arrow.fromDefault && r + g + b > 600 ? 0x000000 : 0xffffff;

    this.draw(arrow, x, y, { scale: OBJECT_SCALE * this.unit * scale * fit(arrow, OBJECT_RADIUS * 4), rotation, alpha, tint });
  }

  private drawSliderBall(time: number, slider: SliderObject, end: number) {
    const { objectScale: OBJECT_SCALE } = this.scene;
    const skin = this.skin!;
    const base = OBJECT_SCALE * this.unit;
    const maxSize = OBJECT_RADIUS * 6;

    const ball = ballAt(slider, time);
    const { x, y } = this.toScreen(ball.position);

    const follow = this.frameAt(skin.frames("sliderfollowcircle"), time - slider.time, true);

    if (follow) {
      let scale: number;
      let alpha: number;

      if (time <= end) {
        // The follow circle pops in around the ball as soon as it is being tracked.
        scale = lerp(1, 2, outQuad(clamp01((time - slider.time) / 180)));
        alpha = clamp01((time - slider.time) / 60);
      } else {
        const progress = clamp01((time - end) / 200);
        scale = lerp(2, 1.6, outQuad(progress));
        alpha = 1 - inQuad(progress);
      }

      // Follow circle textures are authored at twice the size they are shown at.
      this.draw(follow, x, y, { scale: base * 0.5 * scale * fit(follow, maxSize), alpha });
    }

    if (time > end) return;

    const ahead = ballAt(slider, Math.min(end, time + 1)).position;
    const behind = ballAt(slider, Math.max(slider.time, time - 1)).position;
    const rotation = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);

    const velocity = slider.lengths[slider.lengths.length - 1]! / slider.spanDuration;
    const frameDelay = Math.max((0.15 / velocity) * (1000 / 60), 1000 / 60);
    const frames = skin.frames("sliderb", "");
    const frame = frames.length > 0 ? frames[Math.floor((time - slider.time) / frameDelay) % frames.length]! : null;

    const tint = skin.bool("AllowSliderBallTint", false) ? this.comboColour(slider.combo) : rgbToHex(skin.colour("SliderBall") ?? [255, 255, 255]);

    // The classic ball has extra shading layers which only apply when the skin doesn't bring its own ball.
    const ownBall = frame !== null && !frame.fromDefault;
    const under = ownBall ? (skin.has("sliderb-nd") ? skin.tex("sliderb-nd") : null) : skin.tex("sliderb-nd");
    const over = ownBall ? (skin.has("sliderb-spec") ? skin.tex("sliderb-spec") : null) : skin.tex("sliderb-spec");

    if (under) this.draw(under, x, y, { scale: base * fit(under, maxSize), tint: 0x050505 });
    if (frame) this.draw(frame, x, y, { scale: base * fit(frame, maxSize), rotation, tint });
    if (over) this.draw(over, x, y, { scale: base * fit(over, maxSize), additive: true });
  }

  // ---- follow points ------------------------------------------------------------------------------------------

  private drawFollowPoints(time: number) {
    const { preempt: PREEMPT, fadeIn: FADE_IN, objectScale: OBJECT_SCALE } = this.scene;
    const frames = this.skin!.frames("followpoint");
    if (frames.length === 0) return;

    const spacing = 32;
    const preempt = 800 * Math.min(1, PREEMPT / 450);
    const OBJECTS = this.scene.objects;

    for (let i = 1; i < OBJECTS.length; i++) {
      const from = OBJECTS[i - 1]!;
      const to = OBJECTS[i]!;

      if (endTime(from) - preempt > time) continue;
      if (to.time + FADE_IN < time) continue;

      // Follow points only join objects within the same combo, and never involve spinners.
      if (from.combo !== to.combo || from.kind === "spinner" || to.kind === "spinner") continue;

      const start = endPosition(from);
      const end = startPosition(to);
      const startTime = endTime(from);
      const duration = to.time - startTime;
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const rotation = Math.atan2(end.y - start.y, end.x - start.x);

      for (let d = spacing * 1.5; d < distance - spacing; d += spacing) {
        const fraction = d / distance;
        const fadeOutAt = startTime + fraction * duration;
        const fadeInAt = fadeOutAt - preempt;

        if (time < fadeInAt || time > fadeOutAt + FADE_IN) continue;

        const progress = clamp01((time - fadeInAt) / FADE_IN);
        const eased = outQuad(progress);
        const alpha = time > fadeOutAt ? 1 - (time - fadeOutAt) / FADE_IN : progress;

        // Each point slides the last tenth of the way into place as it fades in.
        const at = lerp(fraction - 0.1, fraction, eased);
        const { x, y } = this.toScreen({ x: start.x + (end.x - start.x) * at, y: start.y + (end.y - start.y) * at });

        const frame = this.frameAt(frames, time - fadeInAt, true)!;
        this.draw(frame, x, y, { scale: OBJECT_SCALE * this.unit * lerp(1.5, 1, eased) * fit(frame, OBJECT_RADIUS * 2), rotation, alpha });
      }
    }
  }

  // ---- judgements ---------------------------------------------------------------------------------------------

  private drawJudgement(time: number, object: SceneObject) {
    const { objectScale: OBJECT_SCALE } = this.scene;
    const skin = this.skin!;
    const at = judgementTime(object);
    const elapsed = time - at;

    if (elapsed < 0 || elapsed > JUDGEMENT_FADE_OUT_DELAY + JUDGEMENT_FADE_OUT) return;

    const frames = skin.frames(RESULT_TEXTURE[object.result]);
    if (frames.length === 0) return;

    const animated = frames.length > 1;
    const frame = this.frameAt(frames, elapsed, false)!;
    const position = this.toScreen(object.kind === "spinner" ? startPosition(object) : endPosition(object));
    const base = OBJECT_SCALE * this.unit;

    const alpha = Math.min(clamp01(elapsed / JUDGEMENT_FADE_IN), 1 - clamp01((elapsed - JUDGEMENT_FADE_OUT_DELAY) / JUDGEMENT_FADE_OUT));

    const particleName = RESULT_PARTICLE[object.result];
    const newStyle = particleName !== null && skin.tex(particleName) !== null;

    if (object.result === "miss") {
      let scale = 1;
      let rotation = 0;
      let offsetY = 0;

      // Animated judgements play their frames and nothing else.
      if (!animated) {
        scale = lerp(1.6, 1, inQuad(clamp01(elapsed / 100)));

        const total = JUDGEMENT_FADE_OUT_DELAY + JUDGEMENT_FADE_OUT;
        const tilt = 6 * (object.number % 2 === 0 ? 1 : -1) * (Math.PI / 180);

        rotation = elapsed < JUDGEMENT_FADE_IN ? tilt * (elapsed / JUDGEMENT_FADE_IN) : lerp(tilt, tilt * 2, inQuad((elapsed - JUDGEMENT_FADE_IN) / (total - JUDGEMENT_FADE_IN)));

        // Newer skins have misses fall away.
        if (skin.version > 1) offsetY = (-5 + 80 * inQuad(elapsed / total)) * base;
      }

      this.draw(frame, position.x, position.y + offsetY, { scale: base * scale, rotation, alpha });
      return;
    }

    // The bounce every non-animated hit burst does as it appears.
    const bounce = (finalScale: number) => {
      const t = elapsed / JUDGEMENT_FADE_IN;

      if (t < 0.8) return lerp(0.6, 1.1, t / 0.8);
      if (t < 1) return 1.1;
      if (t < 1.2) return lerp(1.1, 0.9, (t - 1) / 0.2);
      if (t < 1.4) return lerp(0.95, finalScale, (t - 1.2) / 0.2);
      return finalScale;
    };

    if (!newStyle) {
      this.draw(frame, position.x, position.y, { scale: base * (animated ? 1 : bounce(1)), alpha });
      return;
    }

    // Skins with particles get a slow swell, with the classic bounce flashed additively on top for a moment.
    const total = JUDGEMENT_FADE_OUT_DELAY + JUDGEMENT_FADE_OUT;
    this.draw(frame, position.x, position.y, { scale: base * (animated ? 1 : lerp(0.9, 1.05, elapsed / total)), alpha });

    const flash = elapsed < 40 ? 0.5 * outQuad(clamp01((elapsed + 16) / 56)) : 0.5 * (1 - clamp01((elapsed - 40) / 300));
    this.draw(frame, position.x, position.y, { scale: base * (animated ? 1 : bounce(1.05)), alpha: flash * alpha, additive: true });
  }

  // ---- spinner ------------------------------------------------------------------------------------------------

  private drawSpinner(time: number, spinner: SpinnerObject) {
    const { fadeIn: FADE_IN } = this.scene;
    const skin = this.skin!;
    const end = spinner.time + spinner.duration;

    if (time < spinner.time - FADE_IN || time > end + HIT_FADE) return;

    const alpha = Math.min(clamp01((time - (spinner.time - FADE_IN)) / FADE_IN), time > end ? 1 - (time - end) / HIT_FADE : 1);
    const progress = clamp01((time - spinner.time) / (spinner.duration * 0.7));
    const elapsed = Math.max(0, Math.min(spinner.duration, time - spinner.time));
    const rotation = spinRotation(elapsed);

    // Spinners are laid out in a 640x480 space covering the whole screen, with sprites at 0.625x.
    const u = this.unit;
    const sprite = 0.625 * u;
    const left = this.width / 2 - 320 * u;
    const centreX = this.width / 2;
    // The layout is 480 units tall, centred in whatever height there is.
    const top = 29 + (this.height / u - STABLE_HEIGHT) / 2;
    const bottom = top - 29;
    const centreY = (top + 219) * u;

    const hasBackground = skin.has("spinner-background");
    const newStyle = !hasBackground && (skin.has("spinner-top") || skin.tex("spinner-top") !== null);

    const approach = skin.tex("spinner-approachcircle");
    const approachScale = sprite * lerp(1.86, 0.1, clamp01((time - spinner.time) / spinner.duration));

    if (newStyle) {
      const middle2 = skin.tex("spinner-middle2");
      const turn = middle2 ? 0.5 : 1;
      const scale = sprite * (0.8 + outQuad(progress) * 0.2);

      this.draw(skin.tex("spinner-glow"), centreX, centreY, { scale, alpha: alpha * progress, tint: 0x0397ff, additive: true });
      this.draw(skin.tex("spinner-bottom"), centreX, centreY, { scale, alpha, rotation: (rotation * turn) / 3 });
      this.draw(skin.tex("spinner-top"), centreX, centreY, { scale, alpha, rotation: rotation * turn });
      this.draw(middle2, centreX, centreY, { scale, alpha, rotation });

      // The fixed centre piece reddens as time runs out.
      const remaining = 1 - clamp01((time - spinner.time) / spinner.duration);
      const channel = Math.round(255 * remaining);
      this.draw(skin.tex("spinner-middle"), centreX, centreY, { scale, alpha, tint: (255 << 16) | (channel << 8) | channel });

      // The classic skin's new-style spinner has no approach circle.
      if (skin.has("spinner-top")) this.draw(approach, centreX, centreY, { scale: approachScale, alpha });
    } else if (hasBackground) {
      this.draw(skin.tex("spinner-background"), centreX, centreY, { scale: sprite, alpha, tint: rgbToHex(skin.colour("SpinnerBackground") ?? [100, 100, 100]) });
      this.draw(skin.tex("spinner-circle"), centreX, centreY, { scale: sprite, alpha, rotation });

      const metre = skin.tex("spinner-metre");

      if (metre) {
        // The metre fills from the bottom in ten discrete bars.
        const bars = Math.floor(Math.min(0.99, progress) * 10) / 10;

        if (bars > 0) {
          const visible = this.crop(metre, "metre", 0, 1 - bars, 1, 1);
          this.draw(visible, left, (top + 692 * 0.625 * (1 - bars)) * u, { scale: sprite, alpha, anchorX: 0, anchorY: 0 });
        }
      }

      this.draw(approach, centreX, centreY, { scale: approachScale, alpha });
    }

    const slideIn = 50 * (1 - outQuad(clamp01((time - (spinner.time - FADE_IN)) / FADE_IN)));
    this.draw(skin.tex("spinner-rpm"), centreX - 87 * u, (bottom + 445 + slideIn) * u, { scale: sprite, alpha, anchorX: 0, anchorY: 0 });
    this.drawText("score", "477", centreX + 80 * u, (bottom + 448 + slideIn) * u, { scale: sprite * 0.9, anchorX: 1, anchorY: 0, alpha });

    const complete = spinner.time + spinner.duration * 0.7;

    if (time < complete) {
      const spinAlpha = Math.min(clamp01((time - (spinner.time - FADE_IN / 2)) / (FADE_IN / 2)), 1 - clamp01((time - spinner.time - 300) / 300));
      this.draw(skin.tex("spinner-spin"), centreX, (top + 335) * u, { scale: sprite, alpha: alpha * spinAlpha });
    } else {
      const since = time - complete;
      const scale = since < 240 ? lerp(2, 0.8, outQuad(since / 240)) : lerp(0.8, 1, clamp01((since - 240) / 160));
      const clearAlpha = outQuad(clamp01(since / 400)) * (1 - clamp01((time - (end - 50)) / 50));

      this.draw(skin.tex("spinner-clear"), centreX, (top + 115) * u, { scale: sprite * scale, alpha: alpha * clearAlpha });
    }
  }

  // ---- HUD ----------------------------------------------------------------------------------------------------

  private drawHud(time: number) {
    const skin = this.skin!;
    const h = this.hudUnit;
    const hud = this.scene.hudAt(time);

    // Health.
    this.displayedHealth = lerp(this.displayedHealth, hud.health, 0.12);

    // As in lazer, the whole bar comes from whichever skin supplies its background. A skin without one gets the
    // game's own bar, and any other pieces it has go unused.
    const own = skin.has("scorebar-bg");
    const bar = own ? skin : (this.builtIn ?? skin);
    const fromOwn = (name: string) => (own ? (skin.has(name) ? skin.tex(name) : null) : bar.tex(name));
    const background = bar.tex("scorebar-bg");
    const marker = fromOwn("scorebar-marker");
    const newStyle = marker !== null;

    this.draw(background, 0, 0, { scale: h, anchorX: 0, anchorY: 0 });

    const fillFrames = own ? skin.frames("scorebar-colour").filter((f) => !f.fromDefault) : bar.frames("scorebar-colour");
    const fill = this.frameAt(fillFrames, time, true);
    const fillX = (newStyle ? 7.5 : 3) * 1.6 * h;
    const fillY = (newStyle ? 7.8 : 10) * 1.6 * h;
    let fillWidth = 0;
    let fillHeight = 0;

    if (fill) {
      fillWidth = fill.width * h * this.displayedHealth;
      fillHeight = fill.height * h;

      if (this.displayedHealth > 0.004) {
        this.draw(this.crop(fill, "health", 0, 0, this.displayedHealth, 1), fillX, fillY, { scale: h, anchorX: 0, anchorY: 0 });
      }
    }

    if (newStyle) {
      this.draw(marker, fillX + fillWidth, fillY + fillHeight / 2, { scale: h, additive: this.displayedHealth >= 0.5 });
    } else {
      const ki = this.displayedHealth < 0.2 ? fromOwn("scorebar-kidanger2") : this.displayedHealth < 0.5 ? fromOwn("scorebar-kidanger") : null;
      this.draw(ki ?? fromOwn("scorebar-ki"), fillX + fillWidth, fillY, { scale: h });
    }

    this.drawKeyOverlay(time);

    // Score and accuracy, top right.
    const score = this.drawText("score", String(Math.round(hud.score)).padStart(6, "0"), this.width - 10 * h, 0, {
      scale: 0.96 * h,
      anchorX: 1,
      anchorY: 0,
      fixedWidth: true,
    });

    this.drawText("score", `${(hud.accuracy * 100).toFixed(2)}%`, this.width - 17 * h, score.height + 9 * h, {
      scale: 0.6 * 0.96 * h,
      anchorX: 1,
      anchorY: 0,
      fixedWidth: true,
    });

    // Combo, bottom left, with the pop the counter does on every increase.
    if (hud.combo > 0) {
      const since = time - hud.comboChangedAt;
      const text = `${hud.combo}x`;
      const x = 10 * h;
      const y = this.height - 10 * h;
      const scale = 1.28 * h;

      if (since >= 0 && since < 300) {
        this.drawText("combo", text, x, y, { scale: scale * lerp(1.56, 1, since / 300), anchorX: 0, anchorY: 1, alpha: 0.6 * (1 - since / 300), additive: true });
      }

      const bump = since >= 0 && since < 100 ? 1 + 0.1 * Math.sin((since / 100) * Math.PI) : 1;
      this.drawText("combo", text, x, y, { scale: scale * bump, anchorX: 0, anchorY: 1 });
    }
  }

  /** A short piece of text in a plain font, for the few places the game doesn't use a skin's own. */
  private label(text: string): Tex {
    let label = this.labels.get(text);

    if (!label) {
      const resolution = 3;
      const size = 16 * resolution;
      const font = `600 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;

      context.font = font;
      canvas.width = Math.ceil(context.measureText(text).width) + 4;
      canvas.height = Math.ceil(size * 1.3);

      context.font = font;
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, canvas.width / 2, canvas.height / 2);

      label = { texture: Texture.from(canvas), width: canvas.width / resolution, height: canvas.height / resolution, ratio: 1 / resolution, fromDefault: false };
      this.labels.set(text, label);
    }

    return label;
  }

  /** The key overlay at the right edge, laid out as LegacyKeyCounterDisplay does. */
  private drawKeyOverlay(time: number) {
    const skin = this.skin!;
    const h = this.hudUnit;
    const right = this.width;
    const top = this.height / 2 - 40 * 1.6 * h;

    // The background is drawn on its side, hanging down from the top right corner.
    this.draw(skin.tex("inputoverlay-background"), right + h, top, { scale: h, scaleX: 1.05, rotation: Math.PI / 2, anchorX: 0, anchorY: 0 });

    const key = skin.tex("inputoverlay-key");
    const textColour = rgbToHex(skin.colour("InputOverlayText") ?? [0, 0, 0]);
    const clicks = this.scene.clicks;

    // How many clicks have begun by now.
    let low = 0;
    let high = clicks.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (clicks[middle]!.down <= time) low = middle + 1;
      else high = middle;
    }

    for (let i = 0; i < KEY_NAMES.length; i++) {
      // Autoplay alternates between the two keys and never touches the mouse buttons.
      const presses = i === 0 ? Math.ceil(low / 2) : i === 1 ? Math.floor(low / 2) : 0;
      const last = presses > 0 ? clicks[(presses - 1) * 2 + i] : undefined;

      let scale = 1;
      let held = false;

      if (last) {
        held = time < last.up;
        scale = held ? lerp(1, 0.8, outQuad(clamp01((time - last.down) / KEY_TRANSITION))) : lerp(0.8, 1, outQuad(clamp01((time - last.up) / KEY_TRANSITION)));
      }

      const x = right - (KEY_SIZE / 2) * h;
      const y = top + (7.35 + KEY_SIZE / 2 + i * (KEY_SIZE + 1.2)) * h;

      this.draw(key, x, y, { scale: h * scale, tint: held ? KEY_ACTIVE_COLOURS[i] : 0xffffff });
      this.draw(this.label(presses > 0 ? String(presses) : KEY_NAMES[i]!), x, y, { scale: h * scale, tint: textColour });
    }
  }

  // ---- cursor -------------------------------------------------------------------------------------------------

  private drawCursor(time: number) {
    const skin = this.skin!;
    const h = this.hudUnit;

    const centred = skin.bool("CursorCentre", true);
    const anchor = centred ? 0.5 : 0;

    const trail = skin.tex("cursortrail");

    if (trail) {
      const rotates = skin.bool("CursorTrailRotate", true) && skin.bool("CursorRotate", true);
      const parts = this.trailConnected ? this.scene.trailByDistance(time, this.trailFade, this.trailSpacing) : this.scene.trailByTime(time, this.trailFade, 1000 / 60);

      for (const part of parts) {
        const age = time - part.time;
        if (age < 0 || age >= this.trailFade) continue;

        const { x, y } = this.toScreen(part);

        this.draw(trail, x, y, {
          scale: h,
          alpha: 1 - age / this.trailFade,
          additive: this.trailConnected,
          anchorX: this.trailConnected ? 0.5 : anchor,
          anchorY: this.trailConnected ? 0.5 : anchor,
          rotation: rotates ? (part.time / 10000) * Math.PI * 2 : 0,
        });
      }
    }

    const { x, y } = this.toScreen(this.scene.cursorAt(time));

    let expand = 1;

    if (skin.bool("CursorExpand", true)) {
      for (const click of this.scene.clicks) {
        if (click.down > time) break;
        if (time >= click.down && time < click.up) expand = lerp(1, 1.2, outQuad(clamp01((time - click.down) / 100)));
        else if (time >= click.up && time < click.up + 100) expand = lerp(1.2, 1, outQuad((time - click.up) / 100));
      }
    }

    const rotation = skin.bool("CursorRotate", true) ? (time / 10000) * Math.PI * 2 : 0;

    this.draw(skin.tex("cursor"), x, y, { scale: h * expand, rotation, anchorX: anchor, anchorY: anchor });

    // The middle piece belongs to whichever skin supplies the cursor.
    if (!skin.has("cursor") || skin.has("cursormiddle")) this.draw(skin.tex("cursormiddle"), x, y, { scale: h, anchorX: anchor, anchorY: anchor });
  }
}
