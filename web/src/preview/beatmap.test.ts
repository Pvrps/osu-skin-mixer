import { describe, expect, it } from "vitest";
import { parseBeatmap } from "./beatmap";
import { type SceneObject, endTime, pathAt } from "./scene";

const MAP = `osu file format v14

[General]
AudioFilename: audio.mp3
Mode: 0
StackLeniency: 0.7

[Difficulty]
CircleSize:4
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,0,70,1,0
3000,-50,4,1,0,70,0,0

[HitObjects]
100,100,1000,5,0,0:0:0:0:
100,100,1250,1,8,0:0:0:0:
200,200,2000,2,0,L|340:200,2,140
256,192,3000,6,0,P|306:142|356:192,1,280
256,192,6000,12,0,8000
50,50,9000,1,0
`;

describe("parseBeatmap", () => {
  const scene = parseBeatmap(MAP)!;
  type Six = [SceneObject, SceneObject, SceneObject, SceneObject, SceneObject, SceneObject];
  const [first, second, linear, arc, spinner, last] = scene.objects as Six;

  it("reads every kind of object, numbered within its combo", () => {
    expect(scene.objects.map((o) => o.kind)).toEqual(["circle", "circle", "slider", "slider", "spinner", "circle"]);
    expect(scene.objects.map((o) => o.number)).toEqual([1, 2, 3, 1, 1, 1]);
    // A new combo moves to the next colour, and so does whatever follows a spinner.
    expect(scene.objects.map((o) => o.combo)).toEqual([0, 0, 0, 1, 2, 3]);
    expect(spinner).toMatchObject({ kind: "spinner", duration: 2000 });
    expect(last.time).toBe(9000);
  });

  it("times sliders by their length and the slider velocity in force", () => {
    // 140 units at 1.4x is one beat of 500ms, there and back.
    expect(linear).toMatchObject({ kind: "slider", spans: 2, spanDuration: 500 });
    expect(endTime(linear)).toBe(3000);

    // From 3000ms the velocity doubles, so 280 units still take a single beat.
    expect(arc).toMatchObject({ kind: "slider", spans: 1 });
    expect((arc as { spanDuration: number }).spanDuration).toBeCloseTo(500);
    expect((arc as { ticks: number[] }).ticks).toEqual([]);
  });

  it("follows the path the control points describe", () => {
    if (linear.kind !== "slider" || arc.kind !== "slider") throw new Error("expected sliders");

    expect(pathAt(linear, 1).x).toBeCloseTo(340);
    expect(pathAt(linear, 1).y).toBeCloseTo(200);

    // The arc passes over the top of its circle rather than cutting straight across.
    expect(arc.lengths[arc.lengths.length - 1]).toBeCloseTo(280, 0);
    expect(Math.min(...arc.path.map((p) => p.y))).toBeLessThan(145);
  });

  it("fans out objects stacked on the same spot", () => {
    if (first.kind !== "circle" || second.kind !== "circle") throw new Error("expected circles");

    expect(second.position).toEqual({ x: 100, y: 100 });
    expect(first.position.x).toBeLessThan(100);
    expect(first.position.y).toBeLessThan(100);
  });

  it("picks hit sounds from the sample set and the object's additions", () => {
    expect(first.samples).toEqual([["soft-hitnormal"]]);
    expect(second.samples).toEqual([["soft-hitnormal", "soft-hitclap"]]);
    expect(arc.samples![0]).toEqual(["normal-hitnormal"]);
  });

  it("leaves other game modes alone", () => {
    expect(parseBeatmap(MAP.replace("Mode: 0", "Mode: 3"))).toBeNull();
  });
});
