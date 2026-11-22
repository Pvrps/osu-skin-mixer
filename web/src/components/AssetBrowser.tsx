import { useMemo } from "react";
import type { CategoryDef, EmittedFile } from "../lib/categories";
import { iniValue, parseColour } from "../lib/ini";
import { categoriesOf } from "../lib/mix";
import { AUDIO_EXTS, IMAGE_EXTS, type Skin, fileUrl } from "../lib/skins";

interface Props {
  category: CategoryDef;
  skins: Skin[];
  /** The skin currently supplying this category. */
  selected: string | null;
  base: string | null;
  colourOf: (skinId: string) => string;
  onSelect: (skinId: string) => void;
  onHover: (skinId: string | null) => void;
}

const MAX_IMAGES = 24;
const MAX_SOUNDS = 14;

let playing: HTMLAudioElement | null = null;

function playSample(url: string) {
  playing?.pause();
  playing = new Audio(url);
  playing.volume = 0.5;
  void playing.play().catch(() => {});
}

/** One entry per element, preferring the `@2x` file since that is what the game would show. */
function distinct(files: EmittedFile[]): EmittedFile[] {
  const byStem = new Map<string, EmittedFile>();

  for (const file of files) {
    const existing = byStem.get(file.source.stem);
    if (!existing || (file.source.hd && !existing.source.hd)) byStem.set(file.source.stem, file);
  }

  return [...byStem.values()].sort((a, b) => a.source.stem.localeCompare(b.source.stem, undefined, { numeric: true }));
}

const shortName = (file: EmittedFile) => file.source.stem.split("/").pop()!;

function Card({ category, skin, selected, isBase, colour, onSelect, onHover }: {
  category: CategoryDef;
  skin: Skin;
  selected: boolean;
  isBase: boolean;
  colour: string;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}) {
  const files = categoriesOf(skin).get(category.id)!;

  const { images, sounds, others } = useMemo(() => {
    const unique = distinct(files);

    return {
      images: unique.filter((f) => IMAGE_EXTS.has(f.source.ext)),
      sounds: unique.filter((f) => AUDIO_EXTS.has(f.source.ext)),
      others: unique.filter((f) => !IMAGE_EXTS.has(f.source.ext) && !AUDIO_EXTS.has(f.source.ext)),
    };
  }, [files]);

  const settings: { key: string; value: string; colour: string | null }[] = [];

  for (const key of category.ini.General ?? []) {
    const value = iniValue(skin.ini, "General", key);
    if (value !== undefined) settings.push({ key, value, colour: null });
  }

  for (const key of category.ini.Colours ?? []) {
    const value = iniValue(skin.ini, "Colours", key);
    const rgb = parseColour(value);
    if (value !== undefined) settings.push({ key, value, colour: rgb ? `rgb(${rgb.join(",")})` : null });
  }

  if (category.font) {
    const overlap = iniValue(skin.ini, "Fonts", category.font.overlapKey);
    if (overlap !== undefined) settings.push({ key: category.font.overlapKey, value: overlap, colour: null });
  }

  const empty = files.length === 0 && settings.length === 0;

  return (
    <div
      className={`card${selected ? " selected" : ""}`}
      style={{ "--skin": colour } as React.CSSProperties}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="card-head">
        <span className="dot" />
        <span className="card-name" title={skin.name}>
          {skin.name}
        </span>
        {isBase && <span className="tag">base</span>}
        {selected && <span className="tag in-use">in use</span>}
      </div>

      {empty && <div className="card-empty">Nothing of its own here, so the game's default look is used.</div>}

      {images.length > 0 && (
        <div className="thumbs">
          {images.slice(0, MAX_IMAGES).map((file) => (
            <div className="thumb" key={file.source.name} title={file.source.name}>
              <img src={fileUrl(file.source)} loading="lazy" alt={shortName(file)} />
            </div>
          ))}
          {images.length > MAX_IMAGES && <div className="more">+{images.length - MAX_IMAGES} more</div>}
        </div>
      )}

      {sounds.length > 0 && (
        <div className="sounds">
          {sounds.slice(0, MAX_SOUNDS).map((file) => (
            <button
              key={file.source.name}
              className="sound"
              title={`Play ${file.source.name}`}
              onClick={(e) => {
                e.stopPropagation();
                playSample(fileUrl(file.source));
              }}
            >
              ▶ {shortName(file)}
            </button>
          ))}
          {sounds.length > MAX_SOUNDS && <div className="more">+{sounds.length - MAX_SOUNDS} more</div>}
        </div>
      )}

      {settings.length > 0 && (
        <div className="settings">
          {settings.map((s) => (
            <span className="setting" key={s.key} title={`${s.key}: ${s.value}`}>
              {s.colour && <span className="swatch" style={{ background: s.colour }} />}
              {s.key}
              {!s.colour && <b>{s.value}</b>}
            </span>
          ))}
        </div>
      )}

      <div className="card-foot">
        {files.length} file{files.length === 1 ? "" : "s"}
        {others.length > 0 && images.length + sounds.length > 0 ? `, ${others.length} not shown` : ""}
      </div>
    </div>
  );
}

export function AssetBrowser({ category, skins, selected, base, colourOf, onSelect, onHover }: Props) {
  return (
    <div className="cards">
      {skins.map((skin) => (
        <Card
          key={skin.id}
          category={category}
          skin={skin}
          selected={skin.id === selected}
          isBase={skin.id === base}
          colour={colourOf(skin.id)}
          onSelect={() => onSelect(skin.id)}
          onHover={(hovering) => onHover(hovering ? skin.id : null)}
        />
      ))}
    </div>
  );
}
