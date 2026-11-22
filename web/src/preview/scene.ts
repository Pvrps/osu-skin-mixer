/** What the preview plays: a series of hit objects in osu! playfield coordinates (512x384), and an autoplay of them. */

export interface Point {
  x: number;
  y: number;
}

export type HitResult = "great" | "ok" | "meh" | "miss";

interface ObjectBase {
  time: number;
  /** Index of the combo this object belongs to, which picks its combo colour. */
  combo: number;
  /** 1-based number shown inside the circle. */
  number: number;
  result: HitResult;
  /**
   * The samples played at each point the object is hit: once for a circle, at the start and each end of a slider,
   * and at the end of a spinner. Defaults to the plain hit sound.
   */
  samples?: string[][];
}

export interface CircleObject extends ObjectBase {
  kind: "circle";
  position: Point;
}

export interface SliderObject extends ObjectBase {
  kind: "slider";
  id: number;
  path: Point[];
  /** Cumulative length of the path at each point. */
  lengths: number[];
  spanDuration: number;
  spans: number;
  /** Progress (0..1) along a single span at which ticks sit. */
  ticks: number[];
  tickSample?: string;
}

export interface SpinnerObject extends ObjectBase {
  kind: "spinner";
  duration: number;
}

export type SceneObject = CircleObject | SliderObject | SpinnerObject;

export const OBJECT_RADIUS = 64;

/** How long after its time a missed circle is judged. */
export const MISS_DELAY = 110;

export const PLAYFIELD = { width: 512, height: 384 };
export const SPINNER_CENTRE: Point = { x: 256, y: 192 };

export function cumulative(path: Point[]): number[] {
  const lengths = [0];

  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y));
  }

  return lengths;
}

let nextSliderId = 0;

/** Slider bodies are drawn once and kept, so every slider needs an identity of its own. */
export const newSliderId = () => nextSliderId++;

export function endTime(object: SceneObject): number {
  switch (object.kind) {
    case "circle":
      return object.time;
    case "slider":
      return object.time + object.spanDuration * object.spans;
    case "spinner":
      return object.time + object.duration;
  }
}

/** Position along a slider's path at a fraction (0..1) of its length. */
export function pathAt(slider: SliderObject, fraction: number): Point {
  const total = slider.lengths[slider.lengths.length - 1]!;
  const target = Math.max(0, Math.min(1, fraction)) * total;

  // The lengths only ever grow, so the segment holding the target can be found by halving.
  let low = 1;
  let high = slider.lengths.length - 1;

  while (low < high) {
    const middle = (low + high) >> 1;

    if (slider.lengths[middle]! < target) low = middle + 1;
    else high = middle;
  }

  const segment = slider.lengths[low]! - slider.lengths[low - 1]!;
  const t = segment > 0 ? (target - slider.lengths[low - 1]!) / segment : 0;
  const a = slider.path[low - 1]!;
  const b = slider.path[low]!;

  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Where the ball is at a given time, along with which span it is on. */
export function ballAt(slider: SliderObject, time: number): { position: Point; span: number; fraction: number } {
  const elapsed = Math.max(0, Math.min(slider.spanDuration * slider.spans, time - slider.time));
  const span = Math.min(slider.spans - 1, Math.floor(elapsed / slider.spanDuration));
  const within = elapsed / slider.spanDuration - span;
  const fraction = span % 2 === 0 ? within : 1 - within;

  return { position: pathAt(slider, fraction), span, fraction };
}

export function startPosition(object: SceneObject): Point {
  switch (object.kind) {
    case "circle":
      return object.position;
    case "slider":
      return object.path[0]!;
    case "spinner":
      return SPINNER_CENTRE;
  }
}

export function endPosition(object: SceneObject): Point {
  switch (object.kind) {
    case "circle":
      return object.position;
    case "slider":
      return pathAt(object, object.spans % 2 === 1 ? 1 : 0);
    case "spinner":
      return SPINNER_CENTRE;
  }
}

export function judgementTime(object: SceneObject): number {
  return object.result === "miss" && object.kind === "circle" ? object.time + MISS_DELAY : endTime(object);
}

const SPIN_RADIUS = 46;
const SPIN_SPEED = 0.042;

const spinPosition = (elapsed: number): Point => ({
  x: SPINNER_CENTRE.x + Math.cos(elapsed * SPIN_SPEED - Math.PI / 2) * SPIN_RADIUS,
  y: SPINNER_CENTRE.y + Math.sin(elapsed * SPIN_SPEED - Math.PI / 2) * SPIN_RADIUS,
});

/** How far the spinner has been turned, in radians. */
export const spinRotation = (elapsed: number) => elapsed * SPIN_SPEED;

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

export interface TrailPart extends Point {
  time: number;
}

export interface SoundEvent {
  time: number;
  samples: string[];
}

/** Running totals for the HUD at a given time: combo, score and accuracy. */
export interface HudState {
  combo: number;
  /** Time of the most recent combo increase, for the pop animation. */
  comboChangedAt: number;
  score: number;
  accuracy: number;
  health: number;
}

export interface SceneOptions {
  objects: SceneObject[];
  circleSize: number;
  approachRate: number;
  /** The stretch of time the preview plays through before starting over. */
  start: number;
  end: number;
}

const SAMPLE_INTERVAL = 2;
const RESULT_VALUE: Record<HitResult, number> = { great: 300, ok: 100, meh: 50, miss: 0 };
const DEFAULT_SAMPLES = ["normal-hitnormal"];
const INITIAL_HUD: HudState = { combo: 0, comboChangedAt: -Infinity, score: 0, accuracy: 1, health: 1 };

export class Scene {
  readonly objects: SceneObject[];
  readonly start: number;
  readonly end: number;

  /** How much hit objects are scaled by, which follows from the circle size. */
  readonly objectScale: number;
  /** How long before its time an object appears, which follows from the approach rate. */
  readonly preempt: number;
  readonly fadeIn: number;

  /** Times at which the cursor "clicks", for the cursor expand animation. */
  readonly clicks: { down: number; up: number }[];
  readonly sounds: SoundEvent[];

  // The cursor's path, sampled at a fixed rate, along with how far it has travelled by each sample.
  private readonly cursorX: Float32Array;
  private readonly cursorY: Float32Array;
  private readonly travelled: Float64Array;

  private readonly judgedAt: number[] = [];
  private readonly hudAfter: HudState[] = [];

  constructor(options: SceneOptions) {
    this.objects = options.objects;
    this.start = options.start;
    this.end = Math.max(options.start + SAMPLE_INTERVAL, options.end);

    this.objectScale = ((1 - (0.7 * (options.circleSize - 5)) / 5) / 2) * 1.00041;

    const rate = options.approachRate;
    this.preempt = rate < 5 ? 1200 + (600 * (5 - rate)) / 5 : 1200 - (750 * (rate - 5)) / 5;
    this.fadeIn = 400 * Math.min(1, this.preempt / 450);

    this.clicks = this.objects.filter((o) => o.result !== "miss").map((o) => ({ down: o.time, up: Math.max(endTime(o), o.time + 60) }));
    this.sounds = this.buildSounds();

    const count = Math.ceil((this.end - this.start) / SAMPLE_INTERVAL) + 1;
    this.cursorX = new Float32Array(count);
    this.cursorY = new Float32Array(count);
    this.travelled = new Float64Array(count);
    this.sampleCursor();

    this.buildHud();
  }

  /** Follows the objects the way autoplay does: resting on each one, and setting off for the next shortly before it. */
  private sampleCursor() {
    const objects = this.objects;
    let next = 0;
    let rest: Point = SPINNER_CENTRE;
    let restSince = -Infinity;

    for (let s = 0; s < this.cursorX.length; s++) {
      const time = this.start + s * SAMPLE_INTERVAL;

      while (next < objects.length && endTime(objects[next]!) < time) {
        const done = objects[next]!;
        rest = done.kind === "spinner" ? spinPosition(done.duration) : endPosition(done);
        restSince = endTime(done);
        next++;
      }

      let position = rest;
      const object = objects[next];

      if (object) {
        if (time >= object.time) {
          if (object.kind === "slider") position = ballAt(object, time).position;
          else if (object.kind === "spinner") position = spinPosition(time - object.time);
          else position = object.position;
        } else {
          const to = object.kind === "spinner" ? spinPosition(0) : startPosition(object);
          const depart = Math.max(restSince, object.time - 420);
          const t = time <= depart ? 0 : easeOutQuad((time - depart) / (object.time - depart));

          position = { x: rest.x + (to.x - rest.x) * t, y: rest.y + (to.y - rest.y) * t };
        }
      }

      this.cursorX[s] = position.x;
      this.cursorY[s] = position.y;
      this.travelled[s] = s === 0 ? 0 : this.travelled[s - 1]! + Math.hypot(position.x - this.cursorX[s - 1]!, position.y - this.cursorY[s - 1]!);
    }
  }

  private sampleIndex(time: number): number {
    return Math.max(0, Math.min(this.cursorX.length - 1, Math.floor((time - this.start) / SAMPLE_INTERVAL)));
  }

  cursorAt(time: number): Point {
    const index = this.sampleIndex(time);
    return { x: this.cursorX[index]!, y: this.cursorY[index]! };
  }

  /** The trail parts dropped over the last `fade` milliseconds, every `spacing` playfield units the cursor moved. */
  trailByDistance(time: number, fade: number, spacing: number): TrailPart[] {
    const parts: TrailPart[] = [];
    const last = this.sampleIndex(time);

    for (let i = Math.max(1, this.sampleIndex(time - fade)); i <= last; i++) {
      const before = this.travelled[i - 1]!;
      const step = this.travelled[i]! - before;
      if (step <= 0) continue;

      // Parts sit at every multiple of the spacing along the path, so the same ones come back frame after frame.
      for (let at = Math.ceil(before / spacing) * spacing; at < before + step; at += spacing) {
        const t = (at - before) / step;

        parts.push({
          time: this.start + (i - 1 + t) * SAMPLE_INTERVAL,
          x: this.cursorX[i - 1]! + (this.cursorX[i]! - this.cursorX[i - 1]!) * t,
          y: this.cursorY[i - 1]! + (this.cursorY[i]! - this.cursorY[i - 1]!) * t,
        });
      }
    }

    return parts;
  }

  /** The trail parts dropped over the last `fade` milliseconds at a fixed rate. */
  trailByTime(time: number, fade: number, interval: number): TrailPart[] {
    const parts: TrailPart[] = [];

    for (let at = Math.ceil(Math.max(this.start, time - fade) / interval) * interval; at <= time; at += interval) parts.push({ time: at, ...this.cursorAt(at) });

    return parts;
  }

  private buildSounds(): SoundEvent[] {
    const sounds: SoundEvent[] = [];

    for (const object of this.objects) {
      const samples = (node: number) => object.samples?.[node] ?? object.samples?.[0] ?? DEFAULT_SAMPLES;

      if (object.result === "miss") {
        sounds.push({ time: object.time + MISS_DELAY, samples: ["combobreak"] });
        continue;
      }

      if (object.kind === "spinner") {
        for (let t = object.time + 700; t < object.time + object.duration; t += 240) sounds.push({ time: t, samples: ["spinnerbonus"] });
        sounds.push({ time: endTime(object), samples: samples(0) });
        continue;
      }

      sounds.push({ time: object.time, samples: samples(0) });

      if (object.kind === "slider") {
        for (let span = 0; span < object.spans; span++) {
          const spanStart = object.time + span * object.spanDuration;

          for (const tick of object.ticks) {
            sounds.push({ time: spanStart + (span % 2 === 0 ? tick : 1 - tick) * object.spanDuration, samples: [object.tickSample ?? "normal-slidertick"] });
          }

          sounds.push({ time: spanStart + object.spanDuration, samples: samples(span + 1) });
        }
      }
    }

    return sounds.sort((a, b) => a.time - b.time);
  }

  private buildHud() {
    const judgements = this.objects.map((o) => ({ time: judgementTime(o), result: o.result })).sort((a, b) => a.time - b.time);

    let { combo, comboChangedAt, score, health } = INITIAL_HUD;
    let earned = 0;
    let possible = 0;

    for (const j of judgements) {
      possible += 300;
      earned += RESULT_VALUE[j.result];

      if (j.result === "miss") {
        combo = 0;
        health = Math.max(0.1, health - 0.34);
      } else {
        combo++;
        comboChangedAt = j.time;
        score += RESULT_VALUE[j.result] * (1 + combo * 4);
        health = Math.min(1, health + 0.06);
      }

      this.judgedAt.push(j.time);
      this.hudAfter.push({ combo, comboChangedAt, score, accuracy: earned / possible, health });
    }
  }

  hudAt(time: number): HudState {
    // Find how many judgements have happened by now.
    let low = 0;
    let high = this.judgedAt.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (this.judgedAt[middle]! <= time) low = middle + 1;
      else high = middle;
    }

    return low === 0 ? INITIAL_HUD : this.hudAfter[low - 1]!;
  }
}

// ---- the built-in pattern, for when the game has no beatmaps to play ------------------------------------------

function bezier(control: Point[], steps = 48): Point[] {
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let working = control.map((p) => ({ ...p }));

    while (working.length > 1) {
      const next: Point[] = [];
      for (let j = 0; j < working.length - 1; j++) {
        next.push({
          x: working[j]!.x + (working[j + 1]!.x - working[j]!.x) * t,
          y: working[j]!.y + (working[j + 1]!.y - working[j]!.y) * t,
        });
      }
      working = next;
    }

    points.push(working[0]!);
  }

  return points;
}

function slider(base: ObjectBase, control: Point[], spanDuration: number, spans: number, ticks: number[]): SliderObject {
  const path = bezier(control);
  return { ...base, kind: "slider", id: newSliderId(), path, lengths: cumulative(path), spanDuration, spans, ticks };
}

const BEAT = 1000 / 3;

/** A short pattern showing every kind of object and every judgement. */
export const DEMO_SCENE = new Scene({
  circleSize: 4,
  approachRate: 9,
  start: 0,
  end: 9000,
  objects: [
    { kind: "circle", time: 1000, combo: 0, number: 1, result: "great", position: { x: 112, y: 132 } },
    { kind: "circle", time: 1000 + BEAT, combo: 0, number: 2, result: "great", position: { x: 256, y: 84 } },
    { kind: "circle", time: 1000 + BEAT * 2, combo: 0, number: 3, result: "ok", position: { x: 400, y: 132 } },
    slider(
      { time: 1000 + BEAT * 3, combo: 0, number: 4, result: "great" },
      [
        { x: 404, y: 236 },
        { x: 340, y: 316 },
        { x: 248, y: 300 },
      ],
      BEAT * 1.5,
      2,
      [0.5],
    ),
    { kind: "circle", time: 1000 + BEAT * 7, combo: 1, number: 1, result: "great", position: { x: 132, y: 300 } },
    { kind: "circle", time: 1000 + BEAT * 8, combo: 1, number: 2, result: "great", position: { x: 88, y: 196 } },
    slider(
      { time: 1000 + BEAT * 9, combo: 1, number: 3, result: "great" },
      [
        { x: 168, y: 112 },
        { x: 250, y: 60 },
        { x: 290, y: 190 },
        { x: 372, y: 140 },
      ],
      BEAT * 2,
      1,
      [1 / 3, 2 / 3],
    ),
    { kind: "circle", time: 1000 + BEAT * 12, combo: 1, number: 4, result: "miss", position: { x: 428, y: 250 } },
    { kind: "circle", time: 1000 + BEAT * 13, combo: 1, number: 5, result: "meh", position: { x: 312, y: 318 } },
    { kind: "spinner", time: 1000 + BEAT * 14.5, combo: 2, number: 1, result: "great", duration: BEAT * 5.5 },
  ],
});
