import { useEffect, useMemo, useRef, useState } from "react";
import type { CategoryDef } from "../lib/categories";
import { type ElementEntry, type Variant, representative, sortedEntries, variantsOf } from "../lib/elements";
import { type IniSection, iniValue, parseColour } from "../lib/ini";
import { DEFAULT_ID, NONE_ID, type RecolourLookup } from "../lib/mix";
import type { Recolour } from "../lib/recolour";
import { type Skin, fileUrl } from "../lib/skins";
import { IniPanel } from "./IniPanel";
import { Thumb } from "./Thumb";

export interface Hover {
  skinId: string;
  /** The single element being tried, or null when trying a skin for the whole group. */
  element: string | null;
}

interface Props {
  category: CategoryDef;
  /** Every element in the group. */
  entries: Map<string, ElementEntry>;
  /** The element being looked at, or null for the group as a whole. */
  entry: ElementEntry | null;
  /** The user's skins, in the order they are listed. */
  sources: Skin[];
  skinsById: Map<string, Skin>;
  /** Names of the files in the game's own skin, for showing what "game default" looks like. */
  defaults: Set<string> | null;
  /** Whether this group can be hidden or silenced. */
  allowNone: boolean;
  base: string;
  /** The skin the group as a whole comes from. */
  groupSource: string;
  elementSources: Record<string, string>;
  recolours: Record<string, Recolour>;
  lookup: RecolourLookup;
  colourOf: (skinId: string) => string;
  inherited: IniSection[];
  iniOverrides: Record<string, string>;
  onIni: (path: string, value: string | null) => void;
  onChooseGroup: (skinId: string) => void;
  onChooseElement: (element: string, skinId: string) => void;
  onRecolour: (element: string, recolour: Recolour | null) => void;
  onHover: (hover: Hover | null) => void;
  onShowGroup: () => void;
}

/** Above this many options a search box is worth its space. */
const SEARCH_FROM = 9;

const skinStyle = (colour: string) => ({ "--skin": colour }) as React.CSSProperties;

function RecolourControl({ value, onChange }: { value: Recolour | undefined; onChange: (recolour: Recolour | null) => void }) {
  // Dragging around the colour picker reports every colour passed over. Only the one settled on is worth making.
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const colour = draft ?? value?.colour;

  const pick = (picked: string) => {
    setDraft(picked);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onChange({ colour: picked, mode: value?.mode ?? "tint" });
      setDraft(null);
    }, 250);
  };

  return (
    <div className="recolour">
      <label className={`swatch${colour ? " set" : ""}`} style={colour ? { background: colour } : undefined} title="Pick a colour">
        <input type="color" aria-label="Recolour" value={colour ?? "#ffffff"} onChange={(e) => pick(e.target.value)} />
      </label>

      {value ? (
        <>
          <div className="segmented" role="group" aria-label="How to recolour">
            <button className={value.mode === "tint" ? "on" : ""} title="The whole image becomes this colour" onClick={() => onChange({ ...value, mode: "tint" })}>
              Tint
            </button>
            <button className={value.mode === "hue" ? "on" : ""} title="Only its colours change. Whites and shading stay." onClick={() => onChange({ ...value, mode: "hue" })}>
              Hue
            </button>
          </div>
          <button
            className="quiet"
            onClick={() => {
              clearTimeout(timer.current);
              setDraft(null);
              onChange(null);
            }}
          >
            Remove
          </button>
        </>
      ) : (
        <span className="muted">Recolour this image</span>
      )}
    </div>
  );
}

/** The game's own version of an element, where the list of its files says there is one. */
function defaultUrl(category: CategoryDef, entry: ElementEntry, defaults: Set<string> | null): string | null {
  if (!defaults) return null;

  const stem = category.font ? `${category.font.defaultPrefix}-${entry.label}` : entry.element;
  const names = entry.kind === "audio" ? [`${stem}.wav`, `${stem}.ogg`, `${stem}.mp3`] : [`${stem}@2x.png`, `${stem}.png`, `${stem}-0@2x.png`, `${stem}-0.png`];
  const found = names.find((name) => defaults.has(name));

  return found ? `/api/default/file/${found}` : null;
}

function ElementView(props: Props & { entry: ElementEntry }) {
  const { category, entry, skinsById, defaults, allowNone, base, groupSource, elementSources, recolours, lookup, colourOf, onChooseElement, onRecolour, onHover, onShowGroup } = props;
  const [filter, setFilter] = useState("");

  const sourceId = elementSources[entry.element] ?? groupSource;
  const recolour = recolours[entry.element];
  const hasFiles = entry.bySkin.has(sourceId) && sourceId !== NONE_ID;

  // "None" is offered as its own option, so it is left out of the versions which come from skins.
  const variants = useMemo(
    () =>
      variantsOf(entry, skinsById)
        .map((v) => ({ ...v, skins: v.skins.filter((s) => s.id !== NONE_ID) }))
        .filter((v) => v.skins.length > 0)
        .sort((a, b) => Number(b.skins.some((s) => s.id === base)) - Number(a.skins.some((s) => s.id === base)) || a.skins[0]!.name.localeCompare(b.skins[0]!.name)),
    [entry, skinsById, base],
  );

  const needle = filter.trim().toLowerCase();
  const visible = needle ? variants.filter((v) => v.skins.some((s) => s.name.toLowerCase().includes(needle))) : variants;

  const current = hasFiles ? representative(entry.bySkin.get(sourceId)!) : null;
  const made = current && recolour && entry.kind === "image" ? lookup(current.hash, recolour) : undefined;
  const currentUrl = current ? fileUrl(made ? { name: "recoloured.png", hash: made } : current.source) : null;
  const gameUrl = defaultUrl(category, entry, defaults);
  const silent = entry.kind === "audio";

  // Prefer the skin the rest of the group comes from, so picking its version isn't counted as a change.
  const idFor = (variant: Variant) => (variant.skins.find((s) => s.id === groupSource) ?? variant.skins.find((s) => s.id === base) ?? variant.skins[0]!).id;

  const option = (key: string, skinId: string, selected: boolean, thumb: React.ReactNode, name: string, detail: string | null, title: string) => (
    <button
      key={key}
      className={`variant${selected ? " selected" : ""}`}
      style={skinStyle(colourOf(skinId))}
      aria-pressed={selected}
      title={title}
      onClick={() => onChooseElement(entry.element, skinId)}
      onMouseEnter={() => onHover({ skinId, element: entry.element })}
      onMouseLeave={() => onHover(null)}
    >
      {thumb}
      <span className="variant-name">{name}</span>
      {detail && <span className="variant-detail">{detail}</span>}
    </button>
  );

  return (
    <>
      <header className="inspector-head">
        <button className="crumb" onClick={onShowGroup}>
          {category.label}
        </button>
        <h2>{entry.label}</h2>
      </header>

      <div className="inspector-scroll">
        <div className="current">
          <Thumb kind={entry.kind} url={currentUrl ?? (sourceId === NONE_ID ? null : gameUrl)} empty={sourceId === NONE_ID ? (silent ? "silent" : "hidden") : "none"} size="large" />
          <div className="current-info">
            <span className="muted">Currently</span>
            <strong>
              {sourceId === NONE_ID ? (silent ? "Silent" : "Hidden") : hasFiles ? skinsById.get(sourceId)?.name : "Game default"}
              {recolour && hasFiles ? ", recoloured" : ""}
            </strong>
            {!hasFiles && sourceId !== NONE_ID && sourceId !== DEFAULT_ID && <span className="muted">{skinsById.get(sourceId)?.name} doesn't have this, so osu! shows its own.</span>}
            {(sourceId !== base || recolour) && (
              <button
                className="quiet"
                onClick={() => {
                  onRecolour(entry.element, null);
                  onChooseElement(entry.element, groupSource);
                }}
              >
                Undo changes
              </button>
            )}
          </div>
        </div>

        {entry.kind === "image" && hasFiles && <RecolourControl value={recolour} onChange={(r) => onRecolour(entry.element, r)} />}

        <div className="inspector-section">
          <h3>Take it from</h3>
          {variants.length >= SEARCH_FROM && <input type="search" placeholder={`Search ${variants.length} versions by skin`} value={filter} onChange={(e) => setFilter(e.target.value)} />}
        </div>

        <div className="variants">
          {visible.map((variant) => {
            const others = variant.skins.length - 1;
            const first = variant.skins.find((s) => s.id === base) ?? variant.skins[0]!;

            return option(
              first.id,
              idFor(variant),
              hasFiles && variant.skins.some((s) => s.id === sourceId),
              <Thumb kind={entry.kind} url={fileUrl(variant.shown.source)} />,
              first.name,
              variant.skins.some((s) => s.id === base) ? (others > 0 ? `original, and ${others} more` : "original") : others > 0 ? `and ${others} more` : null,
              variant.skins.map((s) => s.name).join("\n"),
            );
          })}

          {needle === "" &&
            option("default", DEFAULT_ID, !hasFiles && sourceId !== NONE_ID, <Thumb kind={entry.kind} url={gameUrl} empty="osu!" />, "Game default", null, "Leave this out of the mix, so osu! shows its own")}

          {needle === "" &&
            allowNone &&
            entry.kind !== "file" &&
            option("none", NONE_ID, sourceId === NONE_ID, <Thumb kind={entry.kind} url={null} empty={silent ? "silent" : "hidden"} />, silent ? "Silent" : "Hidden", null, silent ? "Play nothing" : "Show nothing")}

          {visible.length === 0 && needle !== "" && <p className="muted">No skin matches "{filter}".</p>}
        </div>
      </div>
    </>
  );
}

function GroupView(props: Props) {
  const { category, entries, sources, allowNone, base, groupSource, elementSources, recolours, colourOf, inherited, iniOverrides, onIni, onChooseGroup, onHover } = props;
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => sortedEntries(entries), [entries]);
  const settings = [...(category.ini.General ?? []).map((key) => ["General", key] as const), ...(category.ini.Colours ?? []).map((key) => ["Colours", key] as const)];

  // Only skins which have something to offer here are worth listing.
  const rows = useMemo(
    () =>
      sources
        .map((skin) => ({
          skin,
          has: sorted.filter((e) => e.bySkin.has(skin.id)),
          colours: (category.ini.Colours ?? []).map((key) => parseColour(iniValue(skin.ini, "Colours", key))).filter((c) => c !== null),
          configured: settings.some(([section, key]) => iniValue(skin.ini, section, key) !== undefined),
        }))
        .filter((row) => row.has.length > 0 || row.configured || row.skin.id === base)
        .sort((a, b) => Number(b.skin.id === base) - Number(a.skin.id === base)),
    [sources, sorted, category, base],
  );

  const needle = filter.trim().toLowerCase();
  const visible = needle ? rows.filter((r) => r.skin.name.toLowerCase().includes(needle) || r.skin.creator.toLowerCase().includes(needle)) : rows;
  const changed = new Set([...Object.keys(elementSources), ...Object.keys(recolours)]).size;

  const row = (skinId: string, name: string, detail: string, preview: React.ReactNode, tag: string | null) => (
    <button
      key={skinId}
      className={`skin-row${skinId === groupSource ? " selected" : ""}`}
      style={skinStyle(colourOf(skinId))}
      aria-pressed={skinId === groupSource}
      onClick={() => onChooseGroup(skinId)}
      onMouseEnter={() => onHover({ skinId, element: null })}
      onMouseLeave={() => onHover(null)}
    >
      <span className="skin-row-text">
        <span className="skin-row-name">
          <span className="dot" />
          {name}
          {tag && <span className="tag">{tag}</span>}
        </span>
        <span className="muted">{detail}</span>
      </span>
      <span className="skin-row-preview">{preview}</span>
    </button>
  );

  return (
    <>
      <header className="inspector-head">
        <h2>{category.label}</h2>
        <p className="muted">{category.hint}</p>
      </header>

      <div className="inspector-scroll">
        {sorted.length > 0 && (
          <p className="muted">
            Pick an element on the left to change just that one, or take the whole group from one skin below.
            {changed > 0 && ` ${changed} element${changed === 1 ? " has" : "s have"} been changed individually; picking a skin here replaces ${changed === 1 ? "it" : "them"} too.`}
          </p>
        )}

        <div className="inspector-section">
          <h3>Take all of it from</h3>
          {rows.length >= SEARCH_FROM && <input type="search" placeholder={`Search ${rows.length} skins`} value={filter} onChange={(e) => setFilter(e.target.value)} />}
        </div>

        <div className="skin-rows">
          {visible.map(({ skin, has, colours }) =>
            row(
              skin.id,
              skin.name,
              sorted.length > 0 ? `${has.length} of ${sorted.length} elements` : skin.creator ? `by ${skin.creator}` : "",
              colours.length > 0
                ? colours.map((c, i) => <span key={i} className="chip" style={{ background: `rgb(${c.join(",")})` }} />)
                : has.slice(0, 5).map((e) => <Thumb key={e.element} kind={e.kind} url={e.kind === "image" ? fileUrl(representative(e.bySkin.get(skin.id)!).source) : null} empty="♪" size="small" />),
              skin.id === base ? "original" : null,
            ),
          )}

          {needle === "" && sorted.length > 0 && row(DEFAULT_ID, "Game default", "Leave these out, so osu! shows its own", null, null)}
          {needle === "" && sorted.length > 0 && allowNone && row(NONE_ID, "Nothing", "Hide or silence every one of these", null, null)}
          {visible.length === 0 && needle !== "" && <p className="muted">No skin matches "{filter}".</p>}
        </div>

        <IniPanel category={category} inherited={inherited} overrides={iniOverrides} onChange={onIni} />
      </div>
    </>
  );
}

/** Everything that can be done to whatever is selected on the left: one element, or a whole group of them. */
export function Inspector(props: Props) {
  return <aside className="inspector">{props.entry ? <ElementView key={props.entry.element} {...props} entry={props.entry} /> : <GroupView key={props.category.id} {...props} />}</aside>;
}
