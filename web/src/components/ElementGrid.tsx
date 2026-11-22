import { useMemo, useState } from "react";
import type { CategoryDef, EmittedFile } from "../lib/categories";
import { categoriesOf } from "../lib/mix";
import { NONE_ID } from "../lib/none";
import { AUDIO_EXTS, IMAGE_EXTS, type Skin, fileUrl } from "../lib/skins";

interface Props {
  category: CategoryDef;
  skins: Skin[];
  /** The stand-in for showing or playing nothing, where this category allows it. */
  none: Skin | null;
  /** The skin supplying the category as a whole. */
  categorySource: string | null;
  /** Elements taken from somewhere other than the category's skin. */
  elementSources: Record<string, string>;
  base: string | null;
  colourOf: (skinId: string) => string;
  onSelectCategory: (skinId: string) => void;
  onSelectElement: (element: string, skinId: string) => void;
  onHover: (target: { skinId: string; element: string | null } | null) => void;
}

let playing: HTMLAudioElement | null = null;

function playSample(url: string) {
  playing?.pause();
  playing = new Audio(url);
  playing.volume = 0.5;
  void playing.play().catch(() => {});
}

interface Row {
  element: string;
  label: string;
  /** The file standing for the element in each skin which has it, and how many files it is made of there. */
  bySkin: Map<string, { shown: EmittedFile; count: number }>;
}

/** Picks the file which best represents an element: the first frame, in high resolution where there is one. */
function representative(files: EmittedFile[]): EmittedFile {
  return [...files].sort(
    (a, b) => a.source.stem.localeCompare(b.source.stem, undefined, { numeric: true }) || Number(b.source.hd) - Number(a.source.hd),
  )[0]!;
}

function buildRows(category: CategoryDef, skins: Skin[]): Row[] {
  const rows = new Map<string, Map<string, EmittedFile[]>>();

  for (const skin of skins) {
    for (const file of categoriesOf(skin).get(category.id)!) {
      let bySkin = rows.get(file.element);
      if (!bySkin) rows.set(file.element, (bySkin = new Map()));

      const files = bySkin.get(skin.id);
      if (files) files.push(file);
      else bySkin.set(skin.id, [file]);
    }
  }

  return [...rows]
    .map(([element, bySkin]) => ({
      element,
      // Font glyphs are named for where they end up in the mix, which means nothing to the reader.
      label: category.font ? element.slice(category.font.outPrefix.length + 1) : element,
      bySkin: new Map([...bySkin].map(([skinId, files]) => [skinId, { shown: representative(files), count: files.length }])),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function Cell({ row, skin, isNone, silent, selected, colour, onSelect, onHover }: {
  row: Row;
  skin: Skin;
  isNone: boolean;
  silent: boolean;
  selected: boolean;
  colour: string;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}) {
  const entry = row.bySkin.get(skin.id);
  const file = entry?.shown;

  let content: React.ReactNode;
  let title: string;

  if (isNone) {
    content = <span className="cell-text">{silent ? "silent" : "hidden"}</span>;
    title = `${row.label}: ${silent ? "play nothing" : "show nothing"}`;
  } else if (!file) {
    content = <span className="cell-text faint">game default</span>;
    title = `${skin.name} has no ${row.label}, so the game's default would be used`;
  } else if (IMAGE_EXTS.has(file.source.ext)) {
    content = <img src={fileUrl(file.source)} loading="lazy" alt="" />;
    title = `${row.label} from ${skin.name}${entry.count > 1 ? ` (${entry.count} files)` : ""}`;
  } else if (AUDIO_EXTS.has(file.source.ext)) {
    content = (
      <button
        className="play"
        title={`Play ${file.source.name}`}
        onClick={(e) => {
          e.stopPropagation();
          playSample(fileUrl(file.source));
        }}
      >
        ▶
      </button>
    );
    title = `${row.label} from ${skin.name}`;
  } else {
    content = <span className="cell-text">.{file.source.ext || "file"}</span>;
    title = `${file.source.name} from ${skin.name}`;
  }

  return (
    <div
      className={`cell${selected ? " selected" : ""}`}
      style={{ "--skin": colour } as React.CSSProperties}
      title={title}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {content}
    </div>
  );
}

export function ElementGrid({ category, skins, none, categorySource, elementSources, base, colourOf, onSelectCategory, onSelectElement, onHover }: Props) {
  const [filter, setFilter] = useState("");

  const columns = useMemo(() => (none ? [...skins, none] : skins), [skins, none]);
  const rows = useMemo(() => buildRows(category, columns), [category, columns]);

  const needle = filter.trim().toLowerCase();
  const visible = needle ? rows.filter((r) => r.label.includes(needle)) : rows;
  const silent = category.group === "Audio";
  const mixed = Object.keys(elementSources).length > 0;

  return (
    <div className="grid" style={{ "--columns": columns.length } as React.CSSProperties}>
      <div className="grid-row grid-head">
        <div className="grid-label">
          {rows.length > 10 ? (
            <input type="search" placeholder={`Filter ${rows.length} elements`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          ) : (
            <span className="muted">{rows.length === 0 ? "" : "Use everything from"}</span>
          )}
        </div>
        {columns.map((skin) => (
          <button
            key={skin.id}
            className={`grid-skin${skin.id === categorySource ? " selected" : ""}`}
            style={{ "--skin": colourOf(skin.id) } as React.CSSProperties}
            title={`Use ${skin.name} for everything in ${category.label.toLowerCase()}`}
            onClick={() => onSelectCategory(skin.id)}
            onMouseEnter={() => onHover({ skinId: skin.id, element: null })}
            onMouseLeave={() => onHover(null)}
          >
            <span className="dot" />
            <span className="grid-skin-name">{skin.name}</span>
            {skin.id === base && <span className="tag">base</span>}
            {skin.id === categorySource && <span className="tag in-use">{mixed ? "rest" : "all"}</span>}
          </button>
        ))}
      </div>

      {rows.length === 0 && <p className="grid-empty muted">This category is settings only. Pick the skin whose settings to use above.</p>}
      {rows.length > 0 && visible.length === 0 && <p className="grid-empty muted">Nothing matches "{filter}".</p>}

      {visible.map((row) => {
        const source = elementSources[row.element] ?? categorySource;

        return (
          <div className="grid-row" key={row.element}>
            <div className={`grid-label${elementSources[row.element] ? " overridden" : ""}`} title={row.element}>
              {row.label}
            </div>
            {columns.map((skin) => (
              <Cell
                key={skin.id}
                row={row}
                skin={skin}
                isNone={skin.id === NONE_ID}
                silent={silent}
                selected={skin.id === source}
                colour={colourOf(skin.id)}
                onSelect={() => onSelectElement(row.element, skin.id)}
                onHover={(hovering) => onHover(hovering ? { skinId: skin.id, element: row.element } : null)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
