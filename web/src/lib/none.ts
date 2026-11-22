import { CATEGORIES, type CategoryId } from "./categories";
import { NONE_ID, categoriesOf } from "./mix";
import { AUDIO_EXTS, IMAGE_EXTS, type Skin, describeFile } from "./skins";

export { NONE_ID };

/** Hashes of the invisible image and silent sample the server provides. */
export interface BlankHashes {
  png: string;
  wav: string;
}

// Blanking the interface would leave menus unusable, and combo colours have no files to blank.
const EXCLUDED = new Set<CategoryId>(["other", "colours"]);

export const canBeNone = (category: CategoryId) => !EXCLUDED.has(category);

/**
 * Builds a pretend skin made entirely of blank files, so that "none" can be mixed in like any other source.
 *
 * lazer falls back to its own skin for anything a skin leaves out, so hiding an element means providing a blank
 * file under its name. The names are everything any of the user's skins or the built-in skin has in a category.
 */
export function buildNoneSkin(sources: Skin[], defaultNames: Set<string>, blank: BlankHashes): Skin {
  const builtIn: Skin = {
    id: "built-in",
    name: "",
    creator: "",
    isMix: false,
    files: [...defaultNames].map((name) => describeFile(name, "")),
    ini: [],
  };

  const names = new Map<string, string>();

  for (const category of CATEGORIES) {
    if (!canBeNone(category.id)) continue;

    if (category.font) {
      // With no skin.ini of its own, this skin's fonts sit under the default prefixes.
      for (const glyph of category.font.glyphs) names.set(`${category.font.defaultPrefix}-${glyph}.png`, blank.png);
      continue;
    }

    for (const skin of [...sources, builtIn]) {
      for (const file of categoriesOf(skin).get(category.id)!) {
        if (IMAGE_EXTS.has(file.source.ext)) names.set(`${file.source.stem}.png`, blank.png);
        else if (AUDIO_EXTS.has(file.source.ext)) names.set(`${file.source.stem}.wav`, blank.wav);
      }
    }
  }

  return {
    id: NONE_ID,
    name: "None",
    creator: "",
    isMix: false,
    files: [...names].map(([name, hash]) => describeFile(name, hash)),
    ini: [],
  };
}
