/** The scripted beatmap the preview loops through, in osu! playfield coordinates (512x384). */

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
}

export interface SpinnerObject extends ObjectBase {
  kind: "spinner";
  duration: number;
}

export type SceneObject = CircleObject | SliderObject | SpinnerObject;

export const LOOP_LENGTH = 9000;

export const CIRCLE_SIZE = 4;
export const OBJECT_RADIUS = 64;
export const OBJECT_SCALE = ((1 - (0.7 * (CIRCLE_SIZE - 5)) / 5) / 2) * 1.00041;

// Approach rate 9.
export const PREEMPT = 600;
export const FADE_IN = 400;

/** How long after its time a missed circle is judged. */
export const MISS_DELAY = 110;

export const PLAYFIELD = { width: 512, height: 384 };
export const SPINNER_CENTRE: Point = { x: 256, y: 192 };

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

function cumulative(path: Point[]): number[] {
  const lengths = [0];

  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y));
  }

  return lengths;
}

let nextSliderId = 0;

function slider(base: ObjectBase, control: Point[], spanDuration: number, spans: number, ticks: number[]): SliderObject {
  const path = bezier(control);
  return { ...base, kind: "slider", id: nextSliderId++, path, lengths: cumulative(path), spanDuration, spans, ticks };
}

const BEAT = 1000 / 3;

export const OBJECTS: SceneObject[] = [
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
];

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

  let i = 1;
  while (i < slider.lengths.length - 1 && slider.lengths[i]! < target) i++;

  const segment = slider.lengths[i]! - slider.lengths[i - 1]!;
  const t = segment > 0 ? (target - slider.lengths[i - 1]!) / segment : 0;
  const a = slider.path[i - 1]!;
  const b = slider.path[i]!;

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

const SPIN_RADIUS = 46;
const SPIN_SPEED = 0.042;

const spinPosition = (elapsed: number): Point => ({
  x: SPINNER_CENTRE.x + Math.cos(elapsed * SPIN_SPEED - Math.PI / 2) * SPIN_RADIUS,
  y: SPINNER_CENTRE.y + Math.sin(elapsed * SPIN_SPEED - Math.PI / 2) * SPIN_RADIUS,
});

/** How far the spinner has been turned, in radians. */
export const spinRotation = (elapsed: number) => elapsed * SPIN_SPEED;

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

/** Where an autoplay-style cursor is at a time within the loop. */
function cursorAtRaw(time: number): Point {
  for (let i = 0; i < OBJECTS.length; i++) {
    const object = OBJECTS[i]!;

    if (time >= object.time && time <= endTime(object)) {
      if (object.kind === "slider") return ballAt(object, time).position;
      if (object.kind === "spinner") return spinPosition(time - object.time);
      return object.position;
    }

    if (time < object.time) {
      // Travel from wherever the previous object left the cursor, wrapping around the loop for the first one.
      const previous = OBJECTS[(i + OBJECTS.length - 1) % OBJECTS.length]!;
      const previousEnd = i === 0 ? endTime(previous) - LOOP_LENGTH : endTime(previous);
      const from = previous.kind === "spinner" ? spinPosition(previous.duration) : endPosition(previous);
      const to = object.kind === "spinner" ? spinPosition(0) : startPosition(object);

      // Like autoplay, don't set off until shortly before the next object.
      const depart = Math.max(previousEnd, object.time - 420);
      const t = time <= depart ? 0 : easeOutQuad((time - depart) / (object.time - depart));

      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
  }

  return cursorAtRaw(time - LOOP_LENGTH);
}

const SAMPLE_INTERVAL = 2;
const samples: Point[] = [];

for (let t = 0; t < LOOP_LENGTH; t += SAMPLE_INTERVAL) samples.push(cursorAtRaw(t));

export function cursorAt(time: number): Point {
  const wrapped = ((time % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  return samples[Math.floor(wrapped / SAMPLE_INTERVAL) % samples.length]!;
}

export interface TrailPart extends Point {
  time: number;
}

/** Trail parts dropped at a fixed distance along the cursor's path, as lazer does for connected ("long") trails. */
export function trailByDistance(spacing: number): TrailPart[] {
  const parts: TrailPart[] = [];
  let travelled = 0;
  let nextAt = 0;

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const step = Math.hypot(b.x - a.x, b.y - a.y);

    while (step > 0 && travelled + step >= nextAt) {
      const t = (nextAt - travelled) / step;
      parts.push({ time: (i - 1 + t) * SAMPLE_INTERVAL, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      nextAt += spacing;
    }

    travelled += step;
  }

  return parts;
}

/** Trail parts dropped at a fixed rate, as lazer does for disjoint trails. */
export function trailByTime(interval: number): TrailPart[] {
  const parts: TrailPart[] = [];

  for (let t = 0; t < LOOP_LENGTH; t += interval) parts.push({ time: t, ...cursorAt(t) });

  return parts;
}

/** Times at which the cursor "clicks", for the cursor expand animation. */
export const CLICKS: { down: number; up: number }[] = OBJECTS.filter((o) => o.result !== "miss").map((o) => ({
  down: o.time,
  up: Math.max(endTime(o), o.time + 60),
}));

export type SoundName = "hit" | "tick" | "break" | "bonus";

export const SOUNDS: { time: number; sound: SoundName }[] = [];

for (const object of OBJECTS) {
  if (object.result === "miss") {
    SOUNDS.push({ time: object.time + MISS_DELAY, sound: "break" });
    continue;
  }

  if (object.kind === "spinner") {
    for (let t = object.time + 700; t < object.time + object.duration; t += 240) SOUNDS.push({ time: t, sound: "bonus" });
    SOUNDS.push({ time: endTime(object), sound: "hit" });
    continue;
  }

  SOUNDS.push({ time: object.time, sound: "hit" });

  if (object.kind === "slider") {
    for (let span = 0; span < object.spans; span++) {
      const spanStart = object.time + span * object.spanDuration;

      for (const tick of object.ticks) SOUNDS.push({ time: spanStart + (span % 2 === 0 ? tick : 1 - tick) * object.spanDuration, sound: "tick" });
      SOUNDS.push({ time: spanStart + object.spanDuration, sound: "hit" });
    }
  }
}

SOUNDS.sort((a, b) => a.time - b.time);

/** Running totals for the HUD at a given time: combo, score and accuracy. */
export interface HudState {
  combo: number;
  /** Time of the most recent combo increase, for the pop animation. */
  comboChangedAt: number;
  score: number;
  accuracy: number;
  health: number;
}

const JUDGEMENTS = OBJECTS.map((o) => ({
  time: o.result === "miss" && o.kind === "circle" ? o.time + MISS_DELAY : endTime(o),
  result: o.result,
})).sort((a, b) => a.time - b.time);

const RESULT_VALUE: Record<HitResult, number> = { great: 300, ok: 100, meh: 50, miss: 0 };

export function hudAt(time: number): HudState {
  let combo = 0;
  let comboChangedAt = -Infinity;
  let score = 0;
  let earned = 0;
  let possible = 0;
  let health = 1;

  for (const j of JUDGEMENTS) {
    if (j.time > time) break;

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
  }

  return { combo, comboChangedAt, score, accuracy: possible > 0 ? earned / possible : 1, health };
}

export function judgementTime(object: SceneObject): number {
  return object.result === "miss" && object.kind === "circle" ? object.time + MISS_DELAY : endTime(object);
}
