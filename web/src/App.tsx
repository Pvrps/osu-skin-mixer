import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "./components/Confirm";
import { type EditorFile, ImageEditor } from "./components/ImageEditor";
import { IniEditor } from "./components/IniEditor";
import { type Hover, Inspector } from "./components/Inspector";
import { Navigator, type Target } from "./components/Navigator";
import { Onboarding } from "./components/Onboarding";
import { Preview } from "./components/Preview";
import { Locate } from "./components/Locate";
import { applyMix, fetchDefaultIndex, fetchState, saveSelection } from "./lib/api";
import { CATEGORY_BY_ID, type CategoryId } from "./lib/categories";
import { buildIndex, labelOf } from "./lib/elements";
import { DEFAULT_ID, DEFAULT_SKIN, EMPTY_SELECTION, type RecolourLookup, type Selection, computeMix, elementSourceFor, isApplied, mixAsSkin, sourceFor } from "./lib/mix";
import { type BlankHashes, NONE_ID, buildNoneSkin, canBeNone } from "./lib/none";
import { type Recolour, generateRecolour, isRecolour, recolourKey } from "./lib/recolour";
import { type Skin, toSkin } from "./lib/skins";

interface Loaded {
  osuDir: string;
  /** Whether osu!'s data was found there at all. */
  missing: boolean;
  findsRunningGame: boolean;
  blank: BlankHashes;
  /** Every skin in the game, the mix itself included once it has been written. */
  skins: Skin[];
}

type Status = { kind: "idle" } | { kind: "applying" } | { kind: "applied"; created: boolean } | { kind: "error"; message: string };

const isCategory = (id: string): id is CategoryId => CATEGORY_BY_ID.has(id as CategoryId);

/** Drops anything in a saved mix which refers to a skin that no longer exists. */
function sanitise(saved: Partial<Selection> | null, skins: Skin[]): Selection {
  const skinId = typeof saved?.skinId === "string" && skins.some((s) => s.id === saved.skinId) ? saved.skinId : null;
  const known = new Set(skins.filter((s) => s.id !== skinId).map((s) => s.id));

  const usable = (category: string, id: unknown): id is string =>
    isCategory(category) && typeof id === "string" && (known.has(id) || id === DEFAULT_ID || (id === NONE_ID && canBeNone(category)));

  const overrides: Selection["overrides"] = {};

  for (const [category, id] of Object.entries(saved?.overrides ?? {})) {
    if (usable(category, id)) overrides[category as CategoryId] = id;
  }

  const elements: Selection["elements"] = {};

  for (const [category, chosen] of Object.entries(saved?.elements ?? {})) {
    const kept = Object.fromEntries(Object.entries(chosen ?? {}).filter(([, id]) => usable(category, id)));
    if (Object.keys(kept).length > 0) elements[category as CategoryId] = kept;
  }

  const recolours: Selection["recolours"] = {};

  for (const [category, chosen] of Object.entries(saved?.recolours ?? {})) {
    if (!isCategory(category)) continue;

    const kept = Object.fromEntries(Object.entries(chosen ?? {}).filter(([, recolour]) => isRecolour(recolour)));
    if (Object.keys(kept).length > 0) recolours[category] = kept;
  }

  const isHash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const edits = Object.fromEntries(Object.entries(saved?.edits ?? {}).filter(([original, edited]) => isHash(original) && isHash(edited)));

  const ini: Record<string, string> = {};

  for (const [path, value] of Object.entries(saved?.ini ?? {})) {
    if (typeof value === "string" && path.includes(".")) ini[path] = value;
  }

  return {
    name: typeof saved?.name === "string" ? saved.name : "",
    skinId,
    base: saved?.base && known.has(saved.base) ? saved.base : null,
    overrides,
    elements,
    recolours,
    edits,
    ini,
  };
}

async function load(): Promise<{ loaded: Loaded; selection: Selection }> {
  const state = await fetchState();
  const skins = state.skins.map(toSkin).sort((a, b) => a.name.localeCompare(b.name));

  return { loaded: { osuDir: state.osuDir, missing: state.missing, findsRunningGame: state.findsRunningGame, blank: state.blank, skins }, selection: sanitise(state.selection, skins) };
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Set<string> | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [target, setTarget] = useState<Target>({ group: "cursor", element: null });
  const [showIni, setShowIni] = useState(false);
  /** The element whose image is open in the editor, if any. */
  const [editing, setEditing] = useState<Target | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    load()
      .then(({ loaded, selection }) => {
        setLoaded(loaded);
        setSelection(selection);
      })
      .catch((e: Error) => setLoadError(e.message));

    void fetchDefaultIndex().then(setDefaults);
  }, []);

  // Remember the mix between visits. The first value is what was just loaded, so it is skipped.
  const lastSaved = useRef<Selection | null>(null);

  useEffect(() => {
    if (!selection) return;

    if (lastSaved.current === null) {
      lastSaved.current = selection;
      return;
    }

    const timer = setTimeout(() => {
      lastSaved.current = selection;
      void saveSelection(selection).catch(() => {});
    }, 300);

    return () => clearTimeout(timer);
  }, [selection]);

  // The mix's own skin is what gets written to, so it is never something to take from.
  const mixSkin = useMemo(() => loaded?.skins.find((s) => s.id === selection?.skinId) ?? null, [loaded, selection?.skinId]);
  const sources = useMemo(() => (loaded?.skins ?? []).filter((s) => s.id !== selection?.skinId), [loaded, selection?.skinId]);

  // "Nothing" is mixed in as a skin made of blank files, and "game default" as a skin with no files at all.
  const noneSkin = useMemo(() => (loaded && defaults ? buildNoneSkin(sources, defaults, loaded.blank) : null), [loaded, sources, defaults]);
  const mixable = useMemo(() => [...sources, DEFAULT_SKIN, ...(noneSkin ? [noneSkin] : [])], [sources, noneSkin]);
  const skinsById = useMemo(() => new Map(mixable.map((s) => [s.id, s])), [mixable]);
  const index = useMemo(() => buildIndex(mixable), [mixable]);

  const colourOf = useCallback(
    (skinId: string) => {
      if (skinId === NONE_ID || skinId === DEFAULT_ID) return "#8b8898";

      const position = Math.max(0, sources.findIndex((s) => s.id === skinId));
      return `hsl(${(position * 137.5 + 265) % 360} 80% 70%)`;
    },
    [sources],
  );

  // Recoloured images are made in the background. Until one is ready the mix shows the original in its place.
  const [recoloured, setRecoloured] = useState<Map<string, string>>(() => new Map());
  const lookup = useCallback<RecolourLookup>((hash, recolour) => recoloured.get(recolourKey(hash, recolour)), [recoloured]);

  const mix = useMemo(() => (selection ? computeMix(mixable, selection, mixSkin, lookup) : null), [selection, mixable, mixSkin, lookup]);

  // What each setting would be without manual values, shown as the placeholder in the settings panel.
  const inherited = useMemo(() => (selection ? (computeMix(mixable, { ...selection, ini: {} }, mixSkin)?.ini ?? []) : []), [selection, mixable, mixSkin]);

  // The mix as it would be if whatever is being hovered were clicked, or null if that changes nothing.
  const trial = useMemo((): Selection | null => {
    if (!selection || !hover || showIni) return null;

    const group = target.group;

    if (hover.element === null) {
      if (hover.skinId === sourceFor(selection, group, skinsById)?.id && Object.keys(selection.elements[group] ?? {}).length === 0) return null;

      const { [group]: _, ...elements } = selection.elements;
      return { ...selection, overrides: { ...selection.overrides, [group]: hover.skinId }, elements };
    }

    if (hover.skinId === elementSourceFor(selection, group, hover.element, skinsById)?.id) return null;

    return { ...selection, elements: { ...selection.elements, [group]: { ...selection.elements[group], [hover.element]: hover.skinId } } };
  }, [selection, hover, target.group, showIni, skinsById]);

  // Hovering shows what the mix would look like, without committing to anything.
  const shown = useMemo(() => (trial ? computeMix(mixable, trial, mixSkin, lookup) : mix), [trial, mix, mixable, mixSkin, lookup]);
  const previewSkin = useMemo(() => (shown && selection ? mixAsSkin(shown, selection.name) : null), [shown, selection?.name]);

  const requested = useRef(new Set<string>());

  useEffect(() => {
    for (const { name, hash, recolour } of [...(mix?.pending ?? []), ...(shown?.pending ?? [])]) {
      const key = recolourKey(hash, recolour);
      if (requested.current.has(key)) continue;

      requested.current.add(key);
      generateRecolour({ name, hash }, recolour)
        .then((made) => setRecoloured((known) => new Map(known).set(key, made)))
        .catch((e: Error) => setStatus({ kind: "error", message: e.message }));
    }
  }, [mix, shown]);

  const recolouring = (mix?.pending.length ?? 0) > 0;

  // Until the list of built-in elements has arrived, a "nothing" in the mix can't be resolved, so hold off judging.
  const usesNone =
    selection !== null && (Object.values(selection.overrides).includes(NONE_ID) || Object.values(selection.elements).some((chosen) => Object.values(chosen ?? {}).includes(NONE_ID)));
  const dirty = mix !== null && !recolouring && (!usesNone || noneSkin !== null) && !isApplied(mix, mixSkin);

  const update = useCallback((change: (s: Selection) => Selection) => {
    setSelection((s) => (s ? change(s) : s));
    setStatus((s) => (s.kind === "applying" ? s : { kind: "idle" }));
  }, []);

  /** Uses one skin for a whole group, dropping any element-by-element choices made within it. */
  const chooseGroup = (group: CategoryId, skinId: string) =>
    update((s) => {
      const overrides = { ...s.overrides };
      const { [group]: _, ...elements } = s.elements;

      if (skinId === s.base) delete overrides[group];
      else overrides[group] = skinId;

      return { ...s, overrides, elements };
    });

  const chooseElement = (group: CategoryId, element: string, skinId: string) =>
    update((s) => {
      const chosen = { ...s.elements[group] };

      // Picking the group's own skin just means the element is no longer an exception.
      if (skinId === (s.overrides[group] ?? s.base)) delete chosen[element];
      else chosen[element] = skinId;

      const { [group]: _, ...elements } = s.elements;
      return { ...s, elements: Object.keys(chosen).length > 0 ? { ...elements, [group]: chosen } : elements };
    });

  const setRecolour = (group: CategoryId, element: string, recolour: Recolour | null) =>
    update((s) => {
      const chosen = { ...s.recolours[group] };

      if (recolour) chosen[element] = recolour;
      else delete chosen[element];

      const { [group]: _, ...recolours } = s.recolours;
      return { ...s, recolours: Object.keys(chosen).length > 0 ? { ...recolours, [group]: chosen } : recolours };
    });

  const setEdit = (original: string, edited: string | null) =>
    update((s) => {
      const edits = { ...s.edits };

      if (edited === null) delete edits[original];
      else edits[original] = edited;

      return { ...s, edits };
    });

  const setIni = (path: string, value: string | null) =>
    update((s) => {
      const ini = { ...s.ini };

      if (value === null) delete ini[path];
      else ini[path] = value;

      return { ...s, ini };
    });

  const apply = async () => {
    if (!mix || !selection || mix.pending.length > 0) return;

    setStatus({ kind: "applying" });

    try {
      const result = await applyMix(selection.name, selection.skinId, mix.files, mix.iniText);
      const applied = { ...selection, skinId: result.id };
      await saveSelection(applied);

      const fresh = await load();
      setLoaded(fresh.loaded);
      setSelection((s) => (s ? { ...s, skinId: result.id } : s));
      setStatus({ kind: "applied", created: result.created });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  if (loadError) {
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <h1>Couldn't read your osu! skins</h1>
          <p className="muted">{loadError}</p>
          <button onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!loaded || !selection) return <div className="onboarding muted">Reading skins…</div>;

  // Nothing can be done until osu! has been found, so reload from scratch once it has.
  if (loaded.missing) return <Locate lookedIn={loaded.osuDir} findsRunningGame={loaded.findsRunningGame} onFound={() => location.reload()} />;

  if (!selection.base || selection.name.trim() === "") {
    return (
      <Onboarding
        skins={loaded.skins}
        index={index}
        osuDir={loaded.osuDir}
        onCreate={(name, base, adoptId) => {
          setSelection({ ...EMPTY_SELECTION, name, base, skinId: adoptId });
          setTarget({ group: "cursor", element: null });
          setStatus({ kind: "idle" });
        }}
      />
    );
  }

  const category = CATEGORY_BY_ID.get(target.group)!;
  const entries = index.get(target.group)!;
  const entry = target.element ? (entries.get(target.element) ?? null) : null;
  const iniCount = Object.keys(selection.ini).length;

  // The images which make up the element open in the editor, in the skin it is currently taken from.
  let editorFiles: EditorFile[] = [];
  let editorTitle = "";

  if (editing?.element) {
    const editingCategory = CATEGORY_BY_ID.get(editing.group)!;
    const source = elementSourceFor(selection, editing.group, editing.element, skinsById);
    const files = (source && index.get(editing.group)!.get(editing.element)?.bySkin.get(source.id)) || [];

    editorTitle = labelOf(editingCategory, editing.element);
    editorFiles = [...files]
      .sort((a, b) => a.source.stem.localeCompare(b.source.stem, undefined, { numeric: true }) || Number(b.source.hd) - Number(a.source.hd))
      .map((f) => ({ name: f.source.name, original: f.hash, current: selection.edits[f.hash] ?? f.hash, stem: f.source.stem, hd: f.source.hd }));
  }

  let note: string | null = null;

  if (trial && hover) {
    const what = hover.element === null ? category.label.toLowerCase() : labelOf(category, hover.element);

    if (hover.skinId === NONE_ID) note = `Trying without ${what}`;
    else if (hover.skinId === DEFAULT_ID) note = `Trying the game's own ${what}`;
    else note = `Trying ${what} from ${skinsById.get(hover.skinId)?.name}`;
  }

  return (
    <div className={`app${showIni ? " with-ini" : ""}`}>
      <header className="topbar">
        <div className="brand">osu! skin mixer</div>

        <input
          className="mix-name"
          type="text"
          aria-label="Skin name"
          title="What the skin is called in osu!"
          spellCheck={false}
          maxLength={100}
          value={selection.name}
          onChange={(e) => update((s) => ({ ...s, name: e.target.value }))}
          onBlur={(e) => {
            // The name can't be left empty, so fall back to something rather than throwing the user back to the start.
            if (e.target.value.trim() === "") update((s) => ({ ...s, name: "My mix" }));
          }}
        />

        <div className="spacer" />

        <div className={`status ${status.kind}`} role="status">
          {status.kind === "error" && `Couldn't apply: ${status.message}`}
          {status.kind === "applying" && "Applying…"}
          {status.kind === "applied" && !dirty && !recolouring && <>{status.created ? "Created." : "Updated."} Refresh the skin in osu! to see it.</>}
          {(status.kind === "idle" || (status.kind === "applied" && (dirty || recolouring))) &&
            (recolouring ? "Recolouring…" : dirty ? (mixSkin ? "Changes not applied yet" : "Not in osu! yet") : "Up to date in osu!")}
        </div>

        <button className={showIni ? "on" : ""} aria-pressed={showIni} onClick={() => setShowIni((v) => !v)}>
          skin.ini{iniCount > 0 ? ` (${iniCount})` : ""}
        </button>

        <button
          className="quiet"
          title="Set this mix aside and begin a new one"
          onClick={async () => {
            const sure = await confirm({
              title: "Start a new mix?",
              detail: `"${selection.name}" stays in osu! as it was last applied, but can no longer be changed from here.`,
              confirm: "Start a new mix",
              destructive: true,
            });

            if (sure) {
              update(() => EMPTY_SELECTION);
              setShowIni(false);
              setEditing(null);
            }
          }}
        >
          New mix
        </button>

        <button className="primary" disabled={!dirty || status.kind === "applying"} onClick={() => void apply()}>
          {mixSkin ? "Apply" : "Create skin"}
        </button>
      </header>

      <Navigator
        index={index}
        selection={selection}
        skinsById={skinsById}
        lookup={lookup}
        colourOf={colourOf}
        target={showIni ? null : target}
        onTarget={(next) => {
          setTarget(next);
          setShowIni(false);
          setHover(null);
        }}
      />

      <main className="stage">
        <Preview skin={previewSkin} defaults={defaults} note={note} />
      </main>

      {showIni ? (
        <aside className="inspector">
          <header className="inspector-head">
            <h2>skin.ini</h2>
            <p className="muted">Set any value yourself, whatever the skins you picked say.</p>
          </header>
          <IniEditor result={mix?.ini ?? []} inherited={inherited} overrides={selection.ini} onChange={setIni} />
        </aside>
      ) : (
        <Inspector
          category={category}
          entries={entries}
          entry={entry}
          sources={sources}
          skinsById={skinsById}
          defaults={defaults}
          allowNone={canBeNone(category.id) && noneSkin !== null}
          base={selection.base}
          groupSource={sourceFor(selection, category.id, skinsById)?.id ?? selection.base}
          elementSources={selection.elements[category.id] ?? {}}
          recolours={selection.recolours[category.id] ?? {}}
          edits={selection.edits}
          lookup={lookup}
          colourOf={colourOf}
          inherited={inherited}
          iniOverrides={selection.ini}
          onIni={setIni}
          onChooseGroup={(skinId) => chooseGroup(category.id, skinId)}
          onChooseElement={(element, skinId) => chooseElement(category.id, element, skinId)}
          onRecolour={(element, recolour) => setRecolour(category.id, element, recolour)}
          onEdit={() => entry && setEditing({ group: category.id, element: entry.element })}
          onRevertEdits={(originals) => originals.forEach((original) => setEdit(original, null))}
          onHover={setHover}
          onShowGroup={() => setTarget({ group: category.id, element: null })}
        />
      )}

      {editing && editorFiles.length > 0 && (
        <ImageEditor
          // A different element, or the same one taken from a different skin, is a fresh start.
          key={`${editing.group}/${editing.element}/${editorFiles.map((f) => f.original).join()}`}
          title={editorTitle}
          files={editorFiles}
          recolour={selection.recolours[editing.group]?.[editing.element!] ?? null}
          onSave={setEdit}
          onRevert={(original) => setEdit(original, null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
