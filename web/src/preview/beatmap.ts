import { type HitResult, type Point, Scene, type SceneObject, type SliderObject, cumulative, endPosition, endTime, newSliderId, startPosition } from "./scene";

/** Reads an osu! standard `.osu` file into something the preview can play. */

interface TimingPoint {
  time: number;
  /** Milliseconds per beat, carried over from the last uninherited point. */
  beatLength: number;
  /** The slider velocity multiplier in force. */
  velocity: number;
  sampleSet: number;
}

const SAMPLE_SETS = ["normal", "normal", "soft", "drum"];
const ADDITIONS: [bit: number, name: string][] = [
  [2, "hitwhistle"],
  [4, "hitfinish"],
  [8, "hitclap"],
];

function sections(text: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current: string[] | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("//")) continue;

    const header = /^\[(.+)\]$/.exec(line);

    if (header) {
      current = [];
      result.set(header[1]!, current);
    } else current?.push(line);
  }

  return result;
}

function keyValues(lines: string[] | undefined): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of lines ?? []) {
    const colon = line.indexOf(":");
    if (colon > 0) result.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  return result;
}

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ---- slider paths ---------------------------------------------------------------------------------------------

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function flattenBezier(control: Point[]): Point[] {
  if (control.length < 2) return [...control];
  if (control.length === 2) return [control[0]!, control[1]!];

  let span = 0;
  for (let i = 1; i < control.length; i++) span += distance(control[i - 1]!, control[i]!);

  const steps = Math.max(8, Math.min(160, Math.ceil(span / 5)));
  const points: Point[] = [];
  const xs = new Float64Array(control.length);
  const ys = new Float64Array(control.length);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    for (let j = 0; j < control.length; j++) {
      xs[j] = control[j]!.x;
      ys[j] = control[j]!.y;
    }

    for (let level = control.length - 1; level > 0; level--) {
      for (let j = 0; j < level; j++) {
        xs[j] = xs[j]! + (xs[j + 1]! - xs[j]!) * t;
        ys[j] = ys[j]! + (ys[j + 1]! - ys[j]!) * t;
      }
    }

    points.push({ x: xs[0]!, y: ys[0]! });
  }

  return points;
}

/** The arc through three points, or null when they are (nearly) in a line. */
function flattenArc(a: Point, b: Point, c: Point): Point[] | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 0.001) return null;

  const aSq = a.x * a.x + a.y * a.y;
  const bSq = b.x * b.x + b.y * b.y;
  const cSq = c.x * c.x + c.y * c.y;
  const centre = {
    x: (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d,
    y: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d,
  };
  const radius = distance(a, centre);

  const from = Math.atan2(a.y - centre.y, a.x - centre.x);
  let to = Math.atan2(c.y - centre.y, c.x - centre.x);

  // Which way round to go is decided by which side of the chord the middle point is on.
  const clockwise = (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x) < 0;

  if (clockwise) while (to < from) to += Math.PI * 2;
  else while (to > from) to -= Math.PI * 2;

  const steps = Math.max(8, Math.min(160, Math.ceil((Math.abs(to - from) * radius) / 5)));
  const points: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const angle = from + ((to - from) * i) / steps;
    points.push({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
  }

  return points;
}

function flattenCatmull(control: Point[]): Point[] {
  const points: Point[] = [];
  const at = (i: number) => control[Math.max(0, Math.min(control.length - 1, i))]!;

  for (let i = 0; i < control.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];

    for (let step = 0; step < 16; step++) {
      const t = step / 16;
      const spline = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

      points.push({ x: spline(p0.x, p1.x, p2.x, p3.x), y: spline(p0.y, p1.y, p2.y, p3.y) });
    }
  }

  points.push(control[control.length - 1]!);
  return points;
}

function flattenSegment(type: string, control: Point[]): Point[] {
  if (control.length < 2) return [...control];

  if (type === "L") return [...control];
  if (type === "C") return flattenCatmull(control);
  if (type === "P" && control.length === 3) return flattenArc(control[0]!, control[1]!, control[2]!) ?? [...control];

  // Within a bezier, a point given twice in a row ends one curve and starts the next.
  const points: Point[] = [];
  let from = 0;

  for (let i = 1; i <= control.length; i++) {
    if (i === control.length || (control[i]!.x === control[i - 1]!.x && control[i]!.y === control[i - 1]!.y)) {
      points.push(...flattenBezier(control.slice(from, i)));
      from = i;
    }
  }

  return points;
}

/** Turns a slider's control points into the line it follows, cut or extended to the length the map asks for. */
function buildPath(start: Point, definition: string, length: number): Point[] {
  const tokens = definition.split("|");
  let type = "B";
  let control: Point[] = [start];
  const points: Point[] = [];

  const flush = () => {
    if (control.length > 1) points.push(...flattenSegment(type, control));
  };

  for (const token of tokens) {
    if (/^[A-Za-z]/.test(token)) {
      // Newer maps can switch curve type part-way, starting the next piece where the last one ended.
      flush();
      control = [control[control.length - 1]!];
      type = token[0]!.toUpperCase();
      continue;
    }

    const [x, y] = token.split(":").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) control.push({ x: x!, y: y! });
  }

  flush();

  // Leave out points which sit on top of the one before, as they have no direction to speak of.
  const path = points.filter((p, i) => i === 0 || distance(p, points[i - 1]!) > 0.001);
  if (path.length === 0) path.push(start);
  if (path.length === 1) path.push({ x: start.x + 0.01, y: start.y });

  if (!(length > 0)) return path;

  const lengths = cumulative(path);
  const total = lengths[lengths.length - 1]!;

  if (total > length) {
    let i = 1;
    while (lengths[i]! < length) i++;

    const t = (length - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!);
    const a = path[i - 1]!;
    const b = path[i]!;

    return [...path.slice(0, i), { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
  }

  if (total < length) {
    // A path which falls short carries on in the direction it was last heading.
    const a = path[path.length - 2]!;
    const b = path[path.length - 1]!;
    const step = distance(a, b);
    const extra = length - total;

    path[path.length - 1] = { x: b.x + ((b.x - a.x) / step) * extra, y: b.y + ((b.y - a.y) / step) * extra };
  }

  return path;
}

// ---- stacking -------------------------------------------------------------------------------------------------

/** Objects placed on top of each other in quick succession are fanned out so each one can be seen, as in the game. */
function applyStacking(objects: SceneObject[], threshold: number, scale: number) {
  const STACK_DISTANCE = 3;
  const height = new Array<number>(objects.length).fill(0);

  for (let i = objects.length - 1; i > 0; i--) {
    let n = i;
    let current = objects[i]!;
    let currentIndex = i;

    if (height[i] !== 0 || current.kind === "spinner") continue;

    if (current.kind === "circle") {
      while (--n >= 0) {
        const other = objects[n]!;
        if (other.kind === "spinner") continue;
        if (current.time - endTime(other) > threshold) break;

        if (other.kind === "slider" && distance(endPosition(other), startPosition(current)) < STACK_DISTANCE) {
          const offset = height[currentIndex]! - height[n]! + 1;

          for (let j = n + 1; j <= i; j++) {
            if (distance(endPosition(other), startPosition(objects[j]!)) < STACK_DISTANCE) height[j]! -= offset;
          }

          break;
        }

        if (distance(startPosition(other), startPosition(current)) < STACK_DISTANCE) {
          height[n] = height[currentIndex]! + 1;
          current = other;
          currentIndex = n;
        }
      }
    } else {
      while (--n >= 0) {
        const other = objects[n]!;
        if (other.kind === "spinner") continue;
        if (current.time - other.time > threshold) break;

        if (distance(endPosition(other), startPosition(current)) < STACK_DISTANCE) {
          height[n] = height[currentIndex]! + 1;
          current = other;
          currentIndex = n;
        }
      }
    }
  }

  objects.forEach((object, i) => {
    const offset = height[i]! * scale * -6.4;
    if (offset === 0) return;

    if (object.kind === "circle") object.position = { x: object.position.x + offset, y: object.position.y + offset };
    else if (object.kind === "slider") object.path = object.path.map((p) => ({ x: p.x + offset, y: p.y + offset }));
  });
}

// ---- the map itself -------------------------------------------------------------------------------------------

/**
 * Autoplay never misses, which would leave half of a skin's hit bursts unseen. A sprinkling of lesser judgements,
 * the same ones every time, shows them all off.
 */
function resultFor(index: number, kind: SceneObject["kind"]): HitResult {
  if (index % 23 === 11) return "ok";
  if (index % 61 === 37) return "meh";
  if (index % 97 === 53 && kind === "circle") return "miss";

  return "great";
}

export function parseBeatmap(text: string): Scene | null {
  const parsed = sections(text);
  const general = keyValues(parsed.get("General"));
  const difficulty = keyValues(parsed.get("Difficulty"));

  if (number(general.get("Mode"), 0) !== 0) return null;

  const circleSize = number(difficulty.get("CircleSize"), 5);
  const approachRate = number(difficulty.get("ApproachRate"), number(difficulty.get("OverallDifficulty"), 5));
  const sliderMultiplier = number(difficulty.get("SliderMultiplier"), 1.4);
  const tickRate = number(difficulty.get("SliderTickRate"), 1);
  const stackLeniency = number(general.get("StackLeniency"), 0.7);
  const defaultSet = Math.max(1, ["none", "normal", "soft", "drum"].indexOf((general.get("SampleSet") ?? "normal").toLowerCase()));

  const timing: TimingPoint[] = [];
  let beatLength = 500;

  for (const line of parsed.get("TimingPoints") ?? []) {
    const parts = line.split(",");
    const time = number(parts[0], NaN);
    const value = number(parts[1], NaN);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;

    const uninherited = parts.length < 7 || parts[6]!.trim() !== "0";
    let velocity = 1;

    if (uninherited && value > 0) beatLength = value;
    else if (value < 0) velocity = Math.max(0.1, Math.min(10, -100 / value));

    timing.push({ time, beatLength, velocity, sampleSet: number(parts[3], 0) || defaultSet });
  }

  timing.sort((a, b) => a.time - b.time);

  // A map's first timing point applies from the very start.
  const first = timing.find((t) => t.beatLength > 0);
  let timingIndex = 0;

  const timingAt = (time: number): TimingPoint => {
    while (timingIndex + 1 < timing.length && timing[timingIndex + 1]!.time <= time) timingIndex++;
    while (timingIndex > 0 && timing[timingIndex]!.time > time) timingIndex--;

    return timing[timingIndex] ?? { time: 0, beatLength: first?.beatLength ?? 500, velocity: 1, sampleSet: defaultSet };
  };

  const samplesFor = (hitSound: number, point: TimingPoint, sets?: string): string[] => {
    const [normalSet, additionSet] = (sets ?? "").split(":").map((s) => Number.parseInt(s, 10));
    const normal = SAMPLE_SETS[normalSet || point.sampleSet] ?? "normal";
    const addition = SAMPLE_SETS[additionSet || normalSet || point.sampleSet] ?? normal;

    return [`${normal}-hitnormal`, ...ADDITIONS.filter(([bit]) => hitSound & bit).map(([, name]) => `${addition}-${name}`)];
  };

  const objects: SceneObject[] = [];
  let combo = -1;
  let numberInCombo = 0;
  let forceNewCombo = true;

  for (const line of parsed.get("HitObjects") ?? []) {
    const parts = line.split(",");
    if (parts.length < 4) continue;

    const position = { x: number(parts[0], 256), y: number(parts[1], 192) };
    const time = number(parts[2], NaN);
    const type = Number.parseInt(parts[3]!, 10);
    const hitSound = Number.parseInt(parts[4] ?? "0", 10) || 0;
    if (!Number.isFinite(time) || !Number.isFinite(type)) continue;

    const spinner = (type & 8) !== 0;

    if (forceNewCombo || type & 4) {
      // The colour can be told to skip ahead as well as move on.
      combo += 1 + (forceNewCombo && !(type & 4) ? 0 : (type >> 4) & 7);
      numberInCombo = 0;
    }

    // Whatever follows a spinner starts a combo of its own.
    forceNewCombo = spinner;
    numberInCombo++;

    const point = timingAt(time);
    const base = { time, combo, number: numberInCombo, result: resultFor(objects.length, spinner ? "spinner" : type & 2 ? "slider" : "circle") };

    if (spinner) {
      const end = number(parts[5], time);
      objects.push({ ...base, kind: "spinner", duration: Math.max(1, end - time), samples: [samplesFor(hitSound, point, parts[6])] });
    } else if (type & 2 && parts.length >= 8) {
      const spans = Math.max(1, Number.parseInt(parts[6]!, 10) || 1);
      const length = number(parts[7], 0);
      const path = buildPath(position, parts[5]!, length);
      const lengths = cumulative(path);
      const total = lengths[lengths.length - 1]!;

      // A beat covers a hundred units at a multiplier of one.
      const perBeat = 100 * sliderMultiplier * point.velocity;
      const spanDuration = Math.max(1, (total / perBeat) * point.beatLength);

      const ticks: number[] = [];
      const tickDistance = perBeat / tickRate;
      // A tick too close to the end would be indistinguishable from the end itself.
      const clearance = (total / spanDuration) * 10;

      if (tickDistance > 0 && total / tickDistance < 512) {
        for (let d = tickDistance; d < total - clearance; d += tickDistance) ticks.push(d / total);
      }

      const edgeSounds = (parts[8] ?? "").split("|");
      const edgeSets = (parts[9] ?? "").split("|");
      const samples = Array.from({ length: spans + 1 }, (_, node) =>
        samplesFor(parts[8] ? Number.parseInt(edgeSounds[node] ?? "0", 10) || 0 : hitSound, timingAt(time + node * spanDuration), edgeSets[node] || parts[10]),
      );

      const slider: SliderObject = { ...base, kind: "slider", id: newSliderId(), path, lengths, spanDuration, spans, ticks, samples, tickSample: `${SAMPLE_SETS[point.sampleSet] ?? "normal"}-slidertick` };
      objects.push(slider);
    } else if (type & 1) {
      objects.push({ ...base, kind: "circle", position, samples: [samplesFor(hitSound, point, parts[5])] });
    }
  }

  if (objects.length === 0) return null;

  objects.sort((a, b) => a.time - b.time);

  const scene = { circleSize, approachRate, start: 0, end: 0, objects };
  const probe = new Scene({ ...scene, objects: [], end: 10 });

  applyStacking(objects, probe.preempt * stackLeniency, probe.objectScale);

  return new Scene({ ...scene, start: Math.max(0, objects[0]!.time - 2000), end: endTime(objects[objects.length - 1]!) + 2000 });
}
