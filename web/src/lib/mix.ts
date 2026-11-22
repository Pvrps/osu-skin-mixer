import { CATEGORIES, CLAIMED_INI_KEYS, type CategoryId, type EmittedFile, categorise } from "./categories";
import { type IniSection, iniValue, serializeIni } from "./ini";
import { type Recolour } from "./recolour";
import { IMAGE_EXTS, type Skin, describeFile } from "./skins";

/** The id standing in for a skin when something is set to show or play nothing. */
export const NONE_ID = "none";

/** A skin with nothing in it. Taking an element from it leaves the element out, so the game shows its own. */
export const DEFAULT_ID = "default";

export const DEFAULT_SKIN: Skin = { id: DEFAULT_ID, name: "Game default", creator: "", files: [], ini: [] };

export interface Selection {
  /** What the mix skin is called in game. */
  name: string;
  /** The skin in the game which this mix was last written to, once it has been. */
  skinId: string | null;
  /** The skin the mix started out as a copy of. Everything comes from it unless changed. */
  base: string | null;
  overrides: Partial<Record<CategoryId, string>>;
  /** Individual elements taken from a different skin than the rest of their category. */
  elements: Partial<Record<CategoryId, Record<string, string>>>;
  /** Images given a different colour, by element. This applies whichever skin the element comes from. */
  recolours: Partial<Record<CategoryId, Record<string, Recolour>>>;
  /** Manual skin.ini values, keyed as `Section.Key`. These win over everything else. */
  ini: Record<string, string>;
}

export const EMPTY_SELECTION: Selection = { name: "", skinId: null, base: null, overrides: {}, elements: {}, recolours: {}, ini: {} };

export interface MixFile {
  name: string;
  hash: string;
}

export interface Mix {
  files: MixFile[];
  ini: IniSection[];
  iniText: string;
  sources: Map<CategoryId, Skin>;
  /** Recoloured images which have not been made yet. Until they are, the mix holds the originals in their place. */
  pending: PendingRecolour[];
}

export interface PendingRecolour {
  name: string;
  hash: string;
  recolour: Recolour;
}

/** Looks up the hash of an image's recoloured version, if it has been made. */
export type RecolourLookup = (hash: string, recolour: Recolour) => string | undefined;

const categorised = new WeakMap<Skin, Map<CategoryId, EmittedFile[]>>();

export function categoriesOf(skin: Skin): Map<CategoryId, EmittedFile[]> {
  let result = categorised.get(skin);

  if (!result) {
    result = categorise(skin);
    categorised.set(skin, result);
  }

  return result;
}

export function sourceFor(selection: Selection, category: CategoryId, skins: Map<string, Skin>): Skin | null {
  const override = selection.overrides[category];
  const overridden = override ? skins.get(override) : undefined;

  return overridden ?? (selection.base ? (skins.get(selection.base) ?? null) : null);
}

/** The skin a single element comes from: its own override if it has one, otherwise its category's skin. */
export function elementSourceFor(selection: Selection, category: CategoryId, element: string, skins: Map<string, Skin>): Skin | null {
  const override = selection.elements[category]?.[element];
  const overridden = override ? skins.get(override) : undefined;

  return overridden ?? sourceFor(selection, category, skins);
}

const lowerName = (name: string) => name.replace(/\\/g, "/").toLowerCase();

/**
 * Builds the mix: for every category, the files and configuration of whichever skin was chosen for it.
 *
 * Returns null until a base skin has been chosen.
 */
export function computeMix(sources: Skin[], selection: Selection, existingMix?: Skin | null, recoloured?: RecolourLookup): Mix | null {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const chosen = new Map<CategoryId, Skin>();

  for (const category of CATEGORIES) {
    const skin = sourceFor(selection, category.id, byId);
    if (!skin) return null;

    chosen.set(category.id, skin);
  }

  const files = new Map<string, MixFile>();
  const pending: PendingRecolour[] = [];

  const emit = (category: CategoryId, skin: Skin, file: EmittedFile) => {
    let { name, hash } = file;
    const recolour = selection.recolours[category]?.[file.element];

    if (recolour && skin.id !== NONE_ID && IMAGE_EXTS.has(file.source.ext)) {
      const done = recoloured?.(hash, recolour);

      if (done) {
        hash = done;
        // Recoloured images are always PNGs, whatever they started as.
        name = name.replace(/\.[^./\\]+$/, ".png");
      } else pending.push({ name, hash, recolour });
    }

    files.set(lowerName(file.name), { name, hash });
  };

  for (const category of CATEGORIES) {
    const source = chosen.get(category.id)!;

    // Elements which were pointed at another skin, leaving out any which point at a skin that has since gone.
    const replaced = new Map<string, Skin>();

    for (const [element, skinId] of Object.entries(selection.elements[category.id] ?? {})) {
      const skin = byId.get(skinId);
      if (skin && skin !== source) replaced.set(element, skin);
    }

    for (const file of categoriesOf(source).get(category.id)!) {
      if (!replaced.has(file.element)) emit(category.id, source, file);
    }

    // A replaced element is taken whole: if the other skin doesn't have it, the game's default shows instead.
    for (const [element, skin] of replaced) {
      for (const file of categoriesOf(skin).get(category.id)!) {
        if (file.element === element) emit(category.id, skin, file);
      }
    }
  }

  // Layouts saved from lazer's own skin editor live in the mix as .json files. Keep any which did not come from a
  // source skin, so mixing never throws away HUD customisation done in game.
  if (existingMix) {
    for (const file of existingMix.files) {
      if (!file.root || file.ext !== "json") continue;

      const cameFromSource = sources.some((s) => s.files.some((f) => f.hash === file.hash && lowerName(f.name) === lowerName(file.name)));
      if (!cameFromSource) files.set(lowerName(file.name), { name: file.name, hash: file.hash });
    }
  }

  const ini = buildIni(chosen, byId.get(selection.base!)!, selection);

  return {
    files: [...files.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ini,
    iniText: serializeIni(ini),
    sources: chosen,
    pending,
  };
}

function buildIni(chosen: Map<CategoryId, Skin>, base: Skin, selection: Selection): IniSection[] {
  const general = new Map<string, string>([
    ["Name", selection.name],
    ["Author", "osu-skin-mixer"],
  ]);
  const colours = new Map<string, string>();
  const fonts = new Map<string, string>();

  const rest = base.ini;

  // Anything not owned by a category (version, animation framerate, other game modes, ...) stays as the mix started.
  copyUnclaimed(rest, "General", CLAIMED_INI_KEYS.general, general);
  copyUnclaimed(rest, "Colours", CLAIMED_INI_KEYS.colours, colours);
  copyUnclaimed(rest, "Fonts", CLAIMED_INI_KEYS.fonts, fonts);

  for (const category of CATEGORIES) {
    const source = chosen.get(category.id)!.ini;

    for (const key of category.ini.General ?? []) copyKey(source, "General", key, general);
    for (const key of category.ini.Colours ?? []) copyKey(source, "Colours", key, colours);

    if (category.font) {
      // Always point at the mix's own glyph location. When the source has no glyphs, lazer finds nothing there
      // and falls back to its default font, exactly as it would for the source skin.
      fonts.set(category.font.prefixKey, category.font.outPrefix);
      copyKey(source, "Fonts", category.font.overlapKey, fonts);
    }
  }

  const sections: IniSection[] = [
    { name: "General", entries: toEntries(general) },
    { name: "Colours", entries: toEntries(colours) },
    { name: "Fonts", entries: toEntries(fonts) },
  ];

  for (const section of rest) {
    if (!["general", "colours", "fonts"].includes(section.name.toLowerCase())) sections.push({ name: section.name, entries: [...section.entries] });
  }

  for (const [path, value] of Object.entries(selection.ini)) {
    const dot = path.indexOf(".");
    if (dot < 0 || value.trim().length === 0) continue;

    setValue(sections, path.slice(0, dot), path.slice(dot + 1), value.trim());
  }

  return sections;
}

function copyKey(source: IniSection[], section: string, key: string, into: Map<string, string>) {
  const value = iniValue(source, section, key);
  if (value !== undefined) into.set(key, value);
}

function copyUnclaimed(source: IniSection[], section: string, claimed: Set<string>, into: Map<string, string>) {
  for (const s of source) {
    if (s.name.toLowerCase() !== section.toLowerCase()) continue;

    for (const e of s.entries) {
      if (!claimed.has(e.key.toLowerCase())) into.set(e.key, e.value);
    }
  }
}

const toEntries = (map: Map<string, string>) => [...map].map(([key, value]) => ({ key, value }));

function setValue(sections: IniSection[], sectionName: string, key: string, value: string) {
  let section = sections.find((s) => s.name.toLowerCase() === sectionName.toLowerCase());

  if (!section) {
    section = { name: sectionName, entries: [] };
    sections.push(section);
  }

  const existing = section.entries.find((e) => e.key.toLowerCase() === key.toLowerCase());

  if (existing) existing.value = value;
  else section.entries.push({ key, value });
}

/** Whether the mix skin in the game already has exactly these contents. */
export function isApplied(mix: Mix, existingMix: Skin | null | undefined): boolean {
  if (!existingMix) return false;

  const existing = new Map<string, string>();

  for (const file of existingMix.files) {
    if (file.root && file.stem === "skin" && file.ext === "ini") continue;
    existing.set(lowerName(file.name), file.hash);
  }

  if (existing.size !== mix.files.length) return false;
  if (mix.files.some((f) => existing.get(lowerName(f.name)) !== f.hash)) return false;

  return serializeIni(existingMix.ini) === mix.iniText;
}

/** Turns a mix into the same shape as a skin read from the game, for the preview. */
export function mixAsSkin(mix: Mix, name: string): Skin {
  return {
    id: "preview",
    name,
    creator: "",
    files: mix.files.map((f) => describeFile(f.name, f.hash)),
    ini: mix.ini,
  };
}
