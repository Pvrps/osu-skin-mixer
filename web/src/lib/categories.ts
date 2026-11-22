import { AUDIO_EXTS, IMAGE_EXTS, type Skin, type SkinFile, fontPrefix } from "./skins";

export type CategoryId =
  | "cursor"
  | "hitcircle"
  | "numbers"
  | "colours"
  | "slider"
  | "spinner"
  | "judgement"
  | "followpoint"
  | "healthbar"
  | "scorefont"
  | "combofont"
  | "hud"
  | "hitsounds"
  | "uisounds"
  | "other";

export interface FontSpec {
  prefixKey: string;
  overlapKey: string;
  defaultPrefix: string;
  /** Where the glyphs live inside the mix. Each font gets its own prefix so fonts from different skins can never collide. */
  outPrefix: string;
  glyphs: string[];
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  group: "Gameplay" | "HUD" | "Audio" | "Everything else";
  hint: string;
  /** Matches the stem of top-level image files belonging to this category. */
  pattern?: RegExp;
  /** Matches the stem of top-level audio files belonging to this category. */
  audioPattern?: RegExp;
  font?: FontSpec;
  /** The skin.ini keys which travel with this category, by section. */
  ini: { General?: string[]; Colours?: string[]; Fonts?: string[] };
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const SCORE_GLYPHS = [...DIGITS, "comma", "dot", "percent", "x"];

export const CATEGORIES: CategoryDef[] = [
  {
    id: "cursor",
    label: "Cursor",
    group: "Gameplay",
    hint: "Cursor, trail and smoke",
    pattern: /^(cursor|cursormiddle|cursortrail|cursor-smoke|cursor-ripple)$/,
    ini: { General: ["CursorRotate", "CursorExpand", "CursorCentre", "CursorTrailRotate"] },
  },
  {
    id: "hitcircle",
    label: "Hit circles",
    group: "Gameplay",
    hint: "Circle, overlay and approach circle",
    pattern: /^(hitcircle|hitcircleoverlay(-\d+)?|hitcircleselect|approachcircle)$/,
    ini: { General: ["HitCircleOverlayAboveNumber", "HitCircleOverlayAboveNumer"] },
  },
  {
    id: "numbers",
    label: "Circle numbers",
    group: "Gameplay",
    hint: "Combo numbers inside circles",
    font: {
      prefixKey: "HitCirclePrefix",
      overlapKey: "HitCircleOverlap",
      defaultPrefix: "default",
      outPrefix: "mixfonts/hitcircle",
      glyphs: DIGITS,
    },
    ini: {},
  },
  {
    id: "colours",
    label: "Combo colours",
    group: "Gameplay",
    hint: "Combo1–Combo8 from skin.ini",
    ini: { Colours: ["Combo1", "Combo2", "Combo3", "Combo4", "Combo5", "Combo6", "Combo7", "Combo8"] },
  },
  {
    id: "slider",
    label: "Sliders",
    group: "Gameplay",
    hint: "Ball, follow circle, ticks, arrow and track colours",
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
    group: "Gameplay",
    hint: "All spinner-* elements",
    pattern: /^spinner-.+$/,
    ini: {
      General: ["SpinnerFadePlayfield", "SpinnerNoBlink", "SpinnerFrequencyModulate"],
      Colours: ["SpinnerBackground", "SpinnerApproachCircle"],
    },
  },
  {
    id: "judgement",
    label: "Hit bursts",
    group: "Gameplay",
    hint: "300 / 100 / 50 / miss, particles and lighting",
    pattern: /^(hit(0|50|100|100k|300|300k|300g)(-\d+)?|particle(50|100|300)|lighting|sliderendmiss|slidertickmiss)$/,
    ini: {},
  },
  {
    id: "followpoint",
    label: "Follow points",
    group: "Gameplay",
    hint: "The trail between objects",
    pattern: /^followpoint(-\d+)?$/,
    ini: {},
  },
  {
    id: "healthbar",
    label: "Health bar",
    group: "HUD",
    hint: "All scorebar-* elements",
    pattern: /^scorebar-.+$/,
    ini: {},
  },
  {
    id: "scorefont",
    label: "Score font",
    group: "HUD",
    hint: "Score and accuracy digits",
    font: {
      prefixKey: "ScorePrefix",
      overlapKey: "ScoreOverlap",
      defaultPrefix: "score",
      outPrefix: "mixfonts/score",
      glyphs: SCORE_GLYPHS,
    },
    ini: {},
  },
  {
    id: "combofont",
    label: "Combo font",
    group: "HUD",
    hint: "Combo counter digits",
    font: {
      prefixKey: "ComboPrefix",
      overlapKey: "ComboOverlap",
      defaultPrefix: "score",
      outPrefix: "mixfonts/combo",
      glyphs: SCORE_GLYPHS,
    },
    ini: {},
  },
  {
    id: "hud",
    label: "HUD extras",
    group: "HUD",
    hint: "Key overlay, countdown, skip, section pass/fail",
    pattern:
      /^(inputoverlay-.+|play-skip(-\d+)?|play-unranked|play-warningarrow|arrow-pause|arrow-warning|section-pass|section-fail|count[123]|go|ready|comboburst(-\d+)?|masking-border)$/,
    ini: { Colours: ["InputOverlayText"] },
  },
  {
    id: "hitsounds",
    label: "Hitsounds",
    group: "Audio",
    hint: "Hit, slider and spinner samples",
    audioPattern:
      /^((normal|soft|drum)-(hit(normal|whistle|finish|clap)|slidertick|sliderslide|sliderwhistle)\d*|spinnerspin|spinnerbonus|combobreak)$/,
    ini: { General: ["LayeredHitSounds"] },
  },
  {
    id: "uisounds",
    label: "Other sounds",
    group: "Audio",
    hint: "Menu, pass/fail and applause samples",
    ini: {},
  },
  {
    id: "other",
    label: "Interface & the rest",
    group: "Everything else",
    hint: "Menus, ranking screen, mod icons, other game modes",
    ini: {},
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

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
      });
    }
  }

  for (const file of skin.files) {
    if (claimedByFont.has(file)) continue;

    // The configuration is always regenerated for the mix.
    if (file.root && file.stem === "skin" && file.ext === "ini") continue;

    result.get(classify(file))!.push({ name: file.name, hash: file.hash, source: file });
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

    return "uisounds";
  }

  return "other";
}
