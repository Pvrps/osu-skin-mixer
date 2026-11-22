import { describe, expect, it } from "vitest";
import { iniValue, parseIni, serializeIni } from "./ini";
import { computeMix, isApplied, mixAsSkin } from "./mix";
import { NONE_ID, buildNoneSkin } from "./none";
import { type Skin, describeFile } from "./skins";

function skin(id: string, ini: string, files: string[]): Skin {
  return { id, name: id, creator: "", isMix: false, ini: parseIni(ini), files: files.map((f) => describeFile(f, `${id}:${f}`)) };
}

const a = skin(
  "a",
  "[General]\nName: A\nVersion: 2.5 // comment\nCursorRotate: 0\n[Colours]\nCombo1: 1,2,3\nSliderBorder: 9,9,9\n[Fonts]\nHitCirclePrefix: num\\berlin\nHitCircleOverlap: 4\n[Mania]\nKeys: 4",
  ["skin.ini", "cursor.png", "cursor@2x.png", "hitcircle.png", "num\\berlin-1.png", "score-1.png", "normal-hitnormal.wav", "menu-back.png", "extra/thing.png"],
);

const b = skin("b", "[General]\nName: B\nCursorRotate: 1\n[Colours]\nCombo1: 7,7,7", ["Skin.ini", "cursor.png", "cursortrail.png", "default-1.png", "hitcircle.png"]);

describe("ini", () => {
  it("round-trips and strips comments", () => {
    expect(iniValue(a.ini, "general", "version")).toBe("2.5");
    expect(parseIni(serializeIni(a.ini))).toEqual(a.ini);
  });
});

describe("computeMix", () => {
  it("needs a base", () => {
    expect(computeMix([a, b], { base: null, overrides: {}, ini: {} }, "mix")).toBeNull();
  });

  it("reproduces the base skin, with fonts moved to their own prefixes", () => {
    const mix = computeMix([a, b], { base: "a", overrides: {}, ini: {} }, "mix")!;
    const names = mix.files.map((f) => f.name);

    expect(names).not.toContain("skin.ini");
    expect(names).toContain("mixfonts/hitcircle-1.png");
    // The score glyphs double as the combo font when no ComboPrefix is set.
    expect(names).toContain("mixfonts/score-1.png");
    expect(names).toContain("mixfonts/combo-1.png");
    expect(names).toContain("extra/thing.png");
    // Everything but skin.ini, with the shared score glyph emitted twice.
    expect(mix.files.length).toBe(a.files.length);

    expect(iniValue(mix.ini, "General", "Name")).toBe("mix");
    expect(iniValue(mix.ini, "General", "Version")).toBe("2.5");
    expect(iniValue(mix.ini, "Fonts", "HitCirclePrefix")).toBe("mixfonts/hitcircle");
    expect(iniValue(mix.ini, "Fonts", "HitCircleOverlap")).toBe("4");
    expect(iniValue(mix.ini, "Mania", "Keys")).toBe("4");
  });

  it("takes a category's files and settings from its override, and nothing else", () => {
    const mix = computeMix([a, b], { base: "a", overrides: { cursor: "b", numbers: "b" }, ini: { "Colours.SliderBorder": "1,1,1" } }, "mix")!;
    const byName = new Map(mix.files.map((f) => [f.name, f.hash]));

    expect(byName.get("cursor.png")).toBe("b:cursor.png");
    expect(byName.get("cursortrail.png")).toBe("b:cursortrail.png");
    // The base's @2x cursor must not leak in and take priority over the chosen one.
    expect(byName.has("cursor@2x.png")).toBe(false);
    expect(byName.get("hitcircle.png")).toBe("a:hitcircle.png");
    expect(byName.get("mixfonts/hitcircle-1.png")).toBe("b:default-1.png");

    expect(iniValue(mix.ini, "General", "CursorRotate")).toBe("1");
    expect(iniValue(mix.ini, "Colours", "Combo1")).toBe("1,2,3");
    expect(iniValue(mix.ini, "Colours", "SliderBorder")).toBe("1,1,1");
    // b sets no overlap, so a's must not carry over to b's glyphs.
    expect(iniValue(mix.ini, "Fonts", "HitCircleOverlap")).toBeUndefined();
  });

  it("blanks every element of a category set to none", () => {
    const none = buildNoneSkin([a, b], new Set(["cursormiddle@2x.png", "spinnerbonus.wav", "menu-button@2x.png"]), { png: "P", wav: "W" });
    const mix = computeMix([a, b, none], { base: "a", overrides: { cursor: NONE_ID, hitsounds: NONE_ID, numbers: NONE_ID }, ini: {} }, "mix")!;
    const byName = new Map(mix.files.map((f) => [f.name, f.hash]));

    // Elements from any skin and from the built-in skin are covered, so nothing can show through.
    for (const name of ["cursor.png", "cursortrail.png", "cursormiddle.png", "mixfonts/hitcircle-0.png"]) expect(byName.get(name)).toBe("P");
    for (const name of ["normal-hitnormal.wav", "spinnerbonus.wav"]) expect(byName.get(name)).toBe("W");

    expect(byName.has("cursor@2x.png")).toBe(false);
    expect(byName.get("hitcircle.png")).toBe("a:hitcircle.png");
    expect(byName.get("menu-back.png")).toBe("a:menu-back.png");
    expect(byName.has("menu-button.png")).toBe(false);
    expect(iniValue(mix.ini, "General", "CursorRotate")).toBeUndefined();
  });

  it("recognises an already applied mix", () => {
    const selection = { base: "a", overrides: { cursor: "b" as const }, ini: {} };
    const mix = computeMix([a, b], selection, "mix")!;
    const applied = mixAsSkin(mix, "mix");

    expect(isApplied(mix, applied)).toBe(true);
    expect(isApplied(computeMix([a, b], { ...selection, overrides: {} }, "mix")!, applied)).toBe(false);
  });
});
