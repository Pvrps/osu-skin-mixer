import { CATEGORIES, type CategoryDef, type CategoryId, type EmittedFile } from "./categories";
import { categoriesOf } from "./mix";
import { AUDIO_EXTS, IMAGE_EXTS, type Skin } from "./skins";

export type ElementKind = "image" | "audio" | "file";

export interface ElementEntry {
  element: string;
  label: string;
  kind: ElementKind;
  /** The files which make up this element in each skin that has it. */
  bySkin: Map<string, EmittedFile[]>;
}

/** Every element found in any skin, by the group it belongs to and then by name. */
export type ElementIndex = Map<CategoryId, Map<string, ElementEntry>>;

/** Font glyphs are named for where they end up in the mix, which means nothing to the reader. */
export const labelOf = (category: CategoryDef, element: string) => (category.font ? element.slice(category.font.outPrefix.length + 1) : element);

function kindOf(file: EmittedFile): ElementKind {
  if (IMAGE_EXTS.has(file.source.ext)) return "image";
  if (AUDIO_EXTS.has(file.source.ext)) return "audio";

  return "file";
}

export function buildIndex(skins: Skin[]): ElementIndex {
  const index: ElementIndex = new Map(CATEGORIES.map((c) => [c.id, new Map()]));

  for (const skin of skins) {
    for (const category of CATEGORIES) {
      const entries = index.get(category.id)!;

      for (const file of categoriesOf(skin).get(category.id)!) {
        let entry = entries.get(file.element);

        if (!entry) {
          entry = { element: file.element, label: labelOf(category, file.element), kind: kindOf(file), bySkin: new Map() };
          entries.set(file.element, entry);
        }

        const files = entry.bySkin.get(skin.id);
        if (files) files.push(file);
        else entry.bySkin.set(skin.id, [file]);
      }
    }
  }

  return index;
}

export const sortedEntries = (entries: Map<string, ElementEntry>) =>
  [...entries.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

/** Picks the file which best represents an element: the first frame, in high resolution where there is one. */
export function representative(files: EmittedFile[]): EmittedFile {
  return [...files].sort(
    (a, b) => a.source.stem.localeCompare(b.source.stem, undefined, { numeric: true }) || Number(b.source.hd) - Number(a.source.hd),
  )[0]!;
}

/** One distinct version of an element, along with every skin which has exactly that version. */
export interface Variant {
  skins: Skin[];
  files: EmittedFile[];
  shown: EmittedFile;
}

/**
 * The distinct versions of an element across all skins. Skins often share files (most are edits of another skin),
 * so skins whose files for the element are identical are folded into one variant.
 */
export function variantsOf(entry: ElementEntry, skins: Map<string, Skin>): Variant[] {
  const variants = new Map<string, Variant>();

  for (const [skinId, files] of entry.bySkin) {
    const skin = skins.get(skinId);
    if (!skin) continue;

    const signature = files
      .map((f) => `${f.name.toLowerCase()}=${f.hash}`)
      .sort()
      .join("|");

    const variant = variants.get(signature);
    if (variant) variant.skins.push(skin);
    else variants.set(signature, { skins: [skin], files, shown: representative(files) });
  }

  return [...variants.values()];
}
