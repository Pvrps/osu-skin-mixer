import { AUDIO_EXTS, IMAGE_EXTS, type Skin, type SkinFile, fontPrefix } from "./skins";

export const SECTIONS = ["Gameplay", "In-game interface", "Screens", "Sounds", "Other game modes", "Everything else"] as const;

export type Section = (typeof SECTIONS)[number];

export interface FontSpec {
  prefixKey: string;
  overlapKey: string;
  defaultPrefix: string;
  /** Where the glyphs live inside the mix. Each font gets its own prefix so fonts from different skins can never collide. */
  outPrefix: string;
  glyphs: string[];
}

interface Def<Id extends string> {
  id: Id;
  label: string;
  section: Section;
  hint: string;
  /** Matches the stem of top-level image files belonging to this group. */
  pattern?: RegExp;
  /** Matches the stem of top-level audio files belonging to this group. */
  audioPattern?: RegExp;
  font?: FontSpec;
  /** The skin.ini keys which travel with this group, by section. */
  ini: { General?: string[]; Colours?: string[]; Fonts?: string[] };
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const SCORE_GLYPHS = [...DIGITS, "comma", "dot", "percent", "x"];
const SAMPLE_SET = "(normal|soft|drum)";

const define = <const Id extends string>(defs: Def<Id>[]) => defs;

/**
 * Every element of a skin belongs to exactly one of these groups, named for where it shows up in the game.
 * A file is given to the first group whose pattern matches it, so the order matters where patterns overlap.
 */
export const CATEGORIES = define([
  {
    id: "cursor",
    label: "Cursor",
    section: "Gameplay",
    hint: "Cursor, trail and smoke",
    pattern: /^(cursor|cursormiddle|cursortrail|cursor-smoke|cursor-ripple)$/,
    ini: { General: ["CursorRotate", "CursorExpand", "CursorCentre", "CursorTrailRotate"] },
  },
  {
    id: "hitcircle",
    label: "Hit circles",
    section: "Gameplay",
    hint: "Circle, overlay and approach circle",
    pattern: /^(hitcircle|hitcircleoverlay(-\d+)?|hitcircleselect|approachcircle)$/,
    ini: { General: ["HitCircleOverlayAboveNumber", "HitCircleOverlayAboveNumer"] },
  },
  {
    id: "numbers",
    label: "Circle numbers",
    section: "Gameplay",
    hint: "The combo numbers inside circles",
    font: { prefixKey: "HitCirclePrefix", overlapKey: "HitCircleOverlap", defaultPrefix: "default", outPrefix: "mixfonts/hitcircle", glyphs: DIGITS },
    ini: {},
  },
  {
    id: "colours",
    label: "Combo colours",
    section: "Gameplay",
    hint: "Combo1 to Combo8 from skin.ini",
    ini: { Colours: ["Combo1", "Combo2", "Combo3", "Combo4", "Combo5", "Combo6", "Combo7", "Combo8"] },
  },
  {
    id: "slider",
    label: "Sliders",
    section: "Gameplay",
    hint: "Ball, follow circle, ticks, reverse arrow and track colours",
    pattern:
      /^(sliderb\d*|sliderb-nd|sliderb-spec|sliderfollowcircle(-\d+)?|sliderscorepoint|reversearrow|sliderstartcircle|sliderstartcircleoverlay(-\d+)?|sliderendcircle|sliderendcircleoverlay(-\d+)?|sliderpoint10|sliderpoint30)$/,
    ini: {
      General: ["SliderBallFlip", "AllowSliderBallTint", "SliderBallFrames", "SliderStyle"],
      Colours: ["SliderBorder", "SliderTrackOverride", "SliderBall"],
    },
  },
  {
    id: "spinner",
    label: "Spinner",
    section: "Gameplay",
    hint: "Everything a spinner is drawn with",
    pattern: /^spinner-.+$/,
    ini: {
      General: ["SpinnerFadePlayfield", "SpinnerNoBlink", "SpinnerFrequencyModulate"],
      Colours: ["SpinnerBackground", "SpinnerApproachCircle"],
    },
  },
  {
    id: "judgement",
    label: "Hit bursts",
    section: "Gameplay",
    hint: "300, 100, 50 and miss, with their particles and lighting",
    pattern: /^(hit(0|50|100|100k|300|300k|300g)(-\d+)?|particle(50|100|300)|lighting|sliderendmiss|slidertickmiss)$/,
    ini: {},
  },
  {
    id: "followpoint",
    label: "Follow points",
    section: "Gameplay",
    hint: "The trail between objects",
    pattern: /^followpoint(-\d+)?$/,
    ini: {},
  },
  {
    id: "comboburst",
    label: "Combo bursts",
    section: "Gameplay",
    hint: "The character which pops up at combo milestones",
    pattern: /^comboburst(-\d+)?$/,
    ini: { General: ["ComboBurstRandom"] },
  },
  {
    id: "healthbar",
    label: "Health bar",
    section: "In-game interface",
    hint: "Background, fill and markers",
    pattern: /^scorebar-.+$/,
    ini: {},
  },
  {
    id: "scorefont",
    label: "Score numbers",
    section: "In-game interface",
    hint: "Score and accuracy digits",
    font: { prefixKey: "ScorePrefix", overlapKey: "ScoreOverlap", defaultPrefix: "score", outPrefix: "mixfonts/score", glyphs: SCORE_GLYPHS },
    ini: {},
  },
  {
    id: "combofont",
    label: "Combo numbers",
    section: "In-game interface",
    hint: "Combo counter digits",
    font: { prefixKey: "ComboPrefix", overlapKey: "ComboOverlap", defaultPrefix: "score", outPrefix: "mixfonts/combo", glyphs: SCORE_GLYPHS },
    ini: {},
  },
  {
    id: "keyoverlay",
    label: "Key overlay",
    section: "In-game interface",
    hint: "The key press counters at the side",
    pattern: /^inputoverlay-.+$/,
    ini: { Colours: ["InputOverlayText"] },
  },
  {
    id: "countdown",
    label: "Countdown and skip",
    section: "In-game interface",
    hint: "Ready, 3, 2, 1, go, the skip button and warning arrows",
    pattern: /^(count[123]|go|ready|play-skip(-\d+)?|play-unranked|play-warningarrow|arrow-pause|arrow-warning|masking-border)$/,
    ini: {},
  },
  {
    id: "section",
    label: "Section pass and fail",
    section: "In-game interface",
    hint: "Shown at breaks",
    pattern: /^section-(pass|fail)$/,
    ini: {},
  },
  {
    id: "pause",
    label: "Pause and fail",
    section: "Screens",
    hint: "Pause and fail overlays and their buttons",
    pattern: /^(pause-.+|fail-background)$/,
    ini: {},
  },
  {
    id: "ranking",
    label: "Results screen",
    section: "Screens",
    hint: "Grades, panels and buttons on the results screen",
    pattern: /^ranking-.+$/,
    ini: {},
  },
  {
    id: "mods",
    label: "Mod icons",
    section: "Screens",
    hint: "The icon for each mod",
    pattern: /^selection-mod-.+$/,
    ini: {},
  },
  {
    id: "songselect",
    label: "Song select",
    section: "Screens",
    hint: "Song select buttons, tabs, stars and scoreboard entries",
    pattern: /^(selection-.+|menu-back(-\d+)?|menu-button-background|button-.+|star2?|mode-.+|scoreentry-.+|songselect-.+)$/,
    ini: { Colours: ["SongSelectActiveText", "SongSelectInactiveText"] },
  },
  {
    id: "menus",
    label: "Menus",
    section: "Screens",
    hint: "Main menu and everything else menu-related",
    pattern: /^(menu-.+|welcome_text|options-offset-tick)$/,
    ini: { Colours: ["MenuGlow"] },
  },
  {
    id: "hitsounds",
    label: "Hit sounds",
    section: "Sounds",
    hint: "Normal, whistle, finish and clap for each sample set",
    audioPattern: new RegExp(`^${SAMPLE_SET}-hit(normal|whistle|finish|clap)\\d*$`),
    ini: { General: ["LayeredHitSounds"] },
  },
  {
    id: "slidersounds",
    label: "Slider sounds",
    section: "Sounds",
    hint: "Ticks, slides and whistles",
    audioPattern: new RegExp(`^${SAMPLE_SET}-slider(tick|slide|whistle)\\d*$`),
    ini: {},
  },
  {
    id: "spinnersounds",
    label: "Spinner sounds",
    section: "Sounds",
    hint: "Spinning and bonus",
    audioPattern: /^spinner(spin|bonus)(-max)?$/,
    ini: {},
  },
  {
    id: "playsounds",
    label: "Gameplay sounds",
    section: "Sounds",
    hint: "Combo break, countdown, section pass and fail, applause",
    audioPattern: /^(combobreak|comboburst(-\d+)?|sectionpass|sectionfail|failsound|applause|count[123]s|gos|readys|pause-loop|nightcore-.+)$/,
    ini: {},
  },
  {
    id: "uisounds",
    label: "Interface sounds",
    section: "Sounds",
    hint: "Menu clicks, hovers and every other sample",
    ini: {},
  },
  {
    id: "taiko",
    label: "osu!taiko",
    section: "Other game modes",
    hint: "Drum, notes and Pippidon",
    pattern: /^(taiko-?.+|taikobigcircle.*|taikohitcircle.*|pippidon.+)$/,
    audioPattern: /^taiko-.+$/,
    ini: {},
  },
  {
    id: "catch",
    label: "osu!catch",
    section: "Other game modes",
    hint: "Fruit and the catcher",
    pattern: /^fruit-.+$/,
    ini: {},
  },
  {
    id: "mania",
    label: "osu!mania",
    section: "Other game modes",
    hint: "Keys, notes and stage",
    pattern: /^mania-.+$/,
    ini: {},
  },
  {
    id: "other",
    label: "Other files",
    section: "Everything else",
    hint: "Files in folders, and anything the mixer doesn't recognise",
    ini: {},
  },
]);

export type CategoryDef = (typeof CATEGORIES)[number] extends Def<infer Id> ? Def<Id> : never;
export type CategoryId = CategoryDef["id"];

export const CATEGORY_BY_ID = new Map<CategoryId, CategoryDef>(CATEGORIES.map((c) => [c.id, c]));

/** Every skin.ini key owned by a specific category, so the remainder can be attributed to "other". */
export const CLAIMED_INI_KEYS: Record<"general" | "colours" | "fonts", Set<string>> = {
  general: new Set(["name", "author"]),
  colours: new Set(),
  fonts: new Set(),
};

for (const c of CATEGORIES) {
  for (const k of c.ini.General ?? []) CLAIMED_INI_KEYS.general.add(k.toLowerCase());
  for (const k of c.ini.Colours ?? []) CLAIMED_INI_KEYS.colours.add(k.toLowerCase());
  if (c.font) {
    CLAIMED_INI_KEYS.fonts.add(c.font.prefixKey.toLowerCase());
    CLAIMED_INI_KEYS.fonts.add(c.font.overlapKey.toLowerCase());
  }
}

/** A file as it will appear in the mix: possibly renamed, always pointing at existing content. */
export interface EmittedFile {
  name: string;
  hash: string;
  source: SkinFile;
  /**
   * The element this file is part of. All the files which make up one thing in game (its `@2x` version, the frames
   * of its animation) share an element, and are always taken from the same skin together.
   */
  element: string;
}

/** Animation frames are numbered `name-0`, `name-1`, ... except for the slider ball, which has no separator. */
function elementOfStem(stem: string, isImage: boolean): string {
  if (!isImage) return stem;
  if (/^sliderb\d+$/.test(stem)) return "sliderb";

  return stem.replace(/-\d+$/, "");
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits a skin's files into categories.
 *
 * Every file lands in exactly one category, except for font glyphs: a skin may use the same glyphs for both its
 * score and combo fonts, in which case they are emitted once for each under that font's own prefix.
 */
export function categorise(skin: Skin): Map<CategoryId, EmittedFile[]> {
  const result = new Map<CategoryId, EmittedFile[]>(CATEGORIES.map((c) => [c.id, []]));
  const claimedByFont = new Set<SkinFile>();

  for (const category of CATEGORIES) {
    if (!category.font) continue;

    const prefix = fontPrefix(skin.ini, category.font.prefixKey, category.font.defaultPrefix);
    const pattern = new RegExp(`^${escapeRegex(prefix)}-(${category.font.glyphs.join("|")})$`);

    for (const file of skin.files) {
      if (!IMAGE_EXTS.has(file.ext)) continue;

      const match = pattern.exec(file.stem);
      if (!match) continue;

      claimedByFont.add(file);
      result.get(category.id)!.push({
        name: `${category.font.outPrefix}-${match[1]}${file.hd ? "@2x" : ""}.${file.ext}`,
        hash: file.hash,
        source: file,
        // Each glyph is its own element, named for where it ends up so it lines up across skins.
        element: `${category.font.outPrefix}-${match[1]}`,
      });
    }
  }

  for (const file of skin.files) {
    if (claimedByFont.has(file)) continue;

    // The configuration is always regenerated for the mix.
    if (file.root && file.stem === "skin" && file.ext === "ini") continue;

    result.get(classify(file))!.push({ name: file.name, hash: file.hash, source: file, element: elementOfStem(file.stem, IMAGE_EXTS.has(file.ext)) });
  }

  return result;
}

function classify(file: SkinFile): CategoryId {
  if (!file.root) return "other";

  if (IMAGE_EXTS.has(file.ext)) {
    for (const category of CATEGORIES) {
      if (category.pattern?.test(file.stem)) return category.id;
    }

    return "other";
  }

  if (AUDIO_EXTS.has(file.ext)) {
    for (const category of CATEGORIES) {
      if (category.audioPattern?.test(file.stem)) return category.id;
    }

    // Skins name their interface samples freely, so whatever isn't a known gameplay sample counts as one.
    return "uisounds";
  }

  return "other";
}
