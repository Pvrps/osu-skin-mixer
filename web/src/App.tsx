import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ElementGrid } from "./components/ElementGrid";
import { IniEditor } from "./components/IniEditor";
import { IniPanel } from "./components/IniPanel";
import { Preview } from "./components/Preview";
import { applyMix, fetchDefaultIndex, fetchState, saveSelection } from "./lib/api";
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from "./lib/categories";
import { type Selection, computeMix, elementSourceFor, isApplied, mixAsSkin, sourceFor } from "./lib/mix";
import { type BlankHashes, NONE_ID, buildNoneSkin, canBeNone } from "./lib/none";
import { type Skin, loadSkin } from "./lib/skins";

interface Loaded {
  mixName: string;
  osuDir: string;
  blank: BlankHashes;
  sources: Skin[];
  mix: Skin | null;
}

type Status = { kind: "idle" } | { kind: "applying" } | { kind: "applied"; created: boolean } | { kind: "error"; message: string };

/** What the lower half of the page is showing: one category's elements, or the skin.ini overrides. */
type View = CategoryId | "ini";

interface Hover {
  skinId: string;
  /** The single element being tried, or null when trying a skin for the whole category. */
  element: string | null;
}

const GROUPS = ["Gameplay", "HUD", "Audio", "Everything else"] as const;

/** Drops anything in a saved selection which refers to a skin that no longer exists. */
function sanitise(saved: Partial<Selection> | null, sources: Skin[]): Selection {
  const known = new Set(sources.map((s) => s.id));
  const usable = (category: string, skinId: unknown): skinId is string =>
    CATEGORY_BY_ID.has(category as CategoryId) && typeof skinId === "string" && (known.has(skinId) || (skinId === NONE_ID && canBeNone(category as CategoryId)));

  const overrides: Selection["overrides"] = {};

  for (const [category, skinId] of Object.entries(saved?.overrides ?? {})) {
    if (usable(category, skinId)) overrides[category as CategoryId] = skinId;
  }

  const elements: Selection["elements"] = {};

  for (const [category, chosen] of Object.entries(saved?.elements ?? {})) {
    const kept = Object.fromEntries(Object.entries(chosen ?? {}).filter(([, skinId]) => usable(category, skinId)));
    if (Object.keys(kept).length > 0) elements[category as CategoryId] = kept;
  }

  const ini: Record<string, string> = {};

  for (const [path, value] of Object.entries(saved?.ini ?? {})) {
    if (typeof value === "string" && path.includes(".")) ini[path] = value;
  }

  return { base: saved?.base && known.has(saved.base) ? saved.base : null, overrides, elements, ini };
}

async function load(): Promise<{ loaded: Loaded; selection: Selection }> {
  const state = await fetchState();
  const skins = await Promise.all(state.skins.map(loadSkin));
  const sources = skins.filter((s) => !s.isMix).sort((a, b) => a.name.localeCompare(b.name));

  return {
    loaded: { mixName: state.mixName, osuDir: state.osuDir, blank: state.blank, sources, mix: skins.find((s) => s.isMix) ?? null },
    selection: sanitise(state.selection, sources),
  };
}

const countElements = (selection: Selection, category?: CategoryId) =>
  Object.entries(selection.elements).reduce((total, [id, chosen]) => total + (category === undefined || category === id ? Object.keys(chosen ?? {}).length : 0), 0);

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Set<string> | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [view, setView] = useState<View>("cursor");
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

  // Remember the selection between visits. The first value is what was just loaded, so it is skipped.
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

  // "None" is mixed in as a skin made of blank files. It can supply any category but can never be the base.
  const noneSkin = useMemo(() => (loaded && defaults ? buildNoneSkin(loaded.sources, defaults, loaded.blank) : null), [loaded, defaults]);
  const mixable = useMemo(() => (loaded ? (noneSkin ? [...loaded.sources, noneSkin] : loaded.sources) : []), [loaded, noneSkin]);
  const skinsById = useMemo(() => new Map(mixable.map((s) => [s.id, s])), [mixable]);

  const colourOf = useCallback(
    (skinId: string) => {
      if (skinId === NONE_ID) return "#8b8898";

      const index = Math.max(0, (loaded?.sources ?? []).findIndex((s) => s.id === skinId));
      return `hsl(${(index * 137.5 + 265) % 360} 75% 68%)`;
    },
    [loaded],
  );

  const mix = useMemo(
    () => (loaded && selection ? computeMix(mixable, selection, loaded.mixName, loaded.mix) : null),
    [loaded, selection, mixable],
  );

  // What each setting would be without manual values, shown as the placeholder in the settings panel.
  const inherited = useMemo(
    () => (loaded && selection ? (computeMix(mixable, { ...selection, ini: {} }, loaded.mixName, loaded.mix)?.ini ?? []) : []),
    [loaded, selection, mixable],
  );

  // The selection as it would be if whatever is being hovered were clicked, or null if that changes nothing.
  const trial = useMemo((): Selection | null => {
    if (!selection || !hover || view === "ini") return null;

    if (hover.element === null) {
      if (hover.skinId === sourceFor(selection, view, skinsById)?.id && countElements(selection, view) === 0) return null;

      const { [view]: _, ...elements } = selection.elements;
      return { ...selection, overrides: { ...selection.overrides, [view]: hover.skinId }, elements };
    }

    if (hover.skinId === elementSourceFor(selection, view, hover.element, skinsById)?.id) return null;

    return { ...selection, elements: { ...selection.elements, [view]: { ...selection.elements[view], [hover.element]: hover.skinId } } };
  }, [selection, hover, view, skinsById]);

  // Hovering shows what the mix would look like, without committing to anything.
  const previewSkin = useMemo(() => {
    if (!loaded) return null;

    const shown = trial ? computeMix(mixable, trial, loaded.mixName, loaded.mix) : mix;
    return shown ? mixAsSkin(shown, loaded.mixName) : null;
  }, [loaded, trial, mix, mixable]);

  // Until the list of built-in elements has arrived, a "none" in the selection can't be resolved, so hold off judging.
  const usesNone =
    selection !== null && (Object.values(selection.overrides).includes(NONE_ID) || Object.values(selection.elements).some((chosen) => Object.values(chosen ?? {}).includes(NONE_ID)));
  const dirty = mix !== null && (!usesNone || noneSkin !== null) && !isApplied(mix, loaded?.mix);

  const update = (change: (s: Selection) => Selection) => {
    setSelection((s) => (s ? change(s) : s));
    setStatus((s) => (s.kind === "applying" ? s : { kind: "idle" }));
  };

  /** Uses one skin for a whole category, dropping any element-by-element choices made within it. */
  const chooseCategory = (categoryId: CategoryId, skinId: string) =>
    update((s) => {
      const overrides = { ...s.overrides };
      const { [categoryId]: _, ...elements } = s.elements;

      if (skinId === s.base) delete overrides[categoryId];
      else overrides[categoryId] = skinId;

      return { ...s, overrides, elements };
    });

  const chooseElement = (categoryId: CategoryId, element: string, skinId: string) =>
    update((s) => {
      const chosen = { ...s.elements[categoryId] };

      // Picking the category's own skin just means the element is no longer an exception.
      if (skinId === sourceFor(s, categoryId, skinsById)?.id) delete chosen[element];
      else chosen[element] = skinId;

      const { [categoryId]: _, ...elements } = s.elements;
      return { ...s, elements: Object.keys(chosen).length > 0 ? { ...elements, [categoryId]: chosen } : elements };
    });

  const setBase = (skinId: string) =>
    update((s) => {
      // An override pointing at the new base is no longer an override.
      const overrides = Object.fromEntries(Object.entries(s.overrides).filter(([, id]) => id !== skinId));
      return { ...s, base: skinId, overrides };
    });

  const setIni = (path: string, value: string | null) =>
    update((s) => {
      const ini = { ...s.ini };

      if (value === null) delete ini[path];
      else ini[path] = value;

      return { ...s, ini };
    });

  const apply = async () => {
    if (!mix || !selection) return;

    setStatus({ kind: "applying" });

    try {
      const result = await applyMix(mix.files, mix.iniText);
      await saveSelection(selection);

      const fresh = await load();
      setLoaded(fresh.loaded);
      setStatus({ kind: "applied", created: result.created });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  if (loadError) {
    return (
      <div className="splash">
        <h1>Couldn't read your osu! skins</h1>
        <p>{loadError}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }

  if (!loaded || !selection) return <div className="splash">Reading skins…</div>;

  if (loaded.sources.length === 0) {
    return (
      <div className="splash">
        <h1>No skins to mix</h1>
        <p>
          No legacy skins were found in <code>{loaded.osuDir}</code>. Import some into osu! and reload this page.
        </p>
      </div>
    );
  }

  if (!selection.base) {
    return (
      <div className="splash">
        <h1>Choose a base skin</h1>
        <p>
          "{loaded.mixName}" starts out as a copy of this skin. You can then swap individual parts for those of any other skin, and change the
          base again later.
        </p>
        <div className="base-choices">
          {loaded.sources.map((skin) => (
            <button key={skin.id} onClick={() => setBase(skin.id)} style={{ "--skin": colourOf(skin.id) } as React.CSSProperties}>
              <span className="dot" />
              {skin.name}
              <small>{skin.files.length} files</small>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const current = view === "ini" ? null : CATEGORY_BY_ID.get(view)!;
  const iniCount = Object.keys(selection.ini).length;
  const changeCount = Object.keys(selection.overrides).length + countElements(selection) + iniCount;

  let note: string | null = null;

  if (trial && hover && current) {
    const name = skinsById.get(hover.skinId)?.name;
    const what = hover.element === null ? current.label.toLowerCase() : current.font ? `${current.label.toLowerCase()} "${hover.element.split("-").pop()}"` : hover.element;

    note = hover.skinId === NONE_ID ? `Trying without ${what}` : `Trying ${what} from ${name}`;
  }

  return (
    <div className="app">
      <header>
        <h1>osu! skin mixer</h1>

        <label className="base">
          Base skin
          <select value={selection.base} onChange={(e) => setBase(e.target.value)}>
            {loaded.sources.map((skin) => (
              <option key={skin.id} value={skin.id}>
                {skin.name}
              </option>
            ))}
          </select>
        </label>

        <button className="quiet" disabled={changeCount === 0} onClick={() => update((s) => ({ ...s, overrides: {}, elements: {}, ini: {} }))}>
          Reset to base
        </button>

        <div className="spacer" />

        <div className={`status ${status.kind}`}>
          {status.kind === "error" && `Couldn't apply: ${status.message}`}
          {status.kind === "applying" && "Applying…"}
          {status.kind === "applied" && !dirty && (
            <>
              {status.created ? `Created "${loaded.mixName}".` : `Updated "${loaded.mixName}".`} In osu!, switch to another skin and back to see it.
            </>
          )}
          {(status.kind === "idle" || (status.kind === "applied" && dirty)) &&
            (dirty ? (loaded.mix ? "Changes not applied yet" : `"${loaded.mixName}" will be created`) : `"${loaded.mixName}" is up to date`)}
        </div>

        <button className="primary" disabled={!dirty || status.kind === "applying"} onClick={() => void apply()}>
          {loaded.mix ? "Apply to skin" : "Create skin"}
        </button>
      </header>

      <nav>
        {GROUPS.map((group) => (
          <section key={group}>
            <h2>{group}</h2>
            {CATEGORIES.filter((c) => c.group === group).map((c) => {
              const source = sourceFor(selection, c.id, skinsById);
              const overridden = selection.overrides[c.id] !== undefined;
              const exceptions = countElements(selection, c.id);

              return (
                <button
                  key={c.id}
                  className={`category${c.id === view ? " active" : ""}`}
                  style={{ "--skin": source ? colourOf(source.id) : "transparent" } as React.CSSProperties}
                  onClick={() => {
                    setView(c.id);
                    setHover(null);
                  }}
                >
                  <span className="category-label">{c.label}</span>
                  <span className={`category-source${overridden ? " overridden" : ""}`}>
                    <span className="dot" />
                    <span className="category-source-name">{source?.name}</span>
                    {exceptions > 0 && <span className="mixed">+{exceptions} mixed</span>}
                  </span>
                </button>
              );
            })}
          </section>
        ))}

        <section>
          <h2>Configuration</h2>
          <button
            className={`category${view === "ini" ? " active" : ""}`}
            onClick={() => {
              setView("ini");
              setHover(null);
            }}
          >
            <span className="category-label">skin.ini overrides</span>
            <span className="category-source">{iniCount === 0 ? "None set" : `${iniCount} value${iniCount === 1 ? "" : "s"} set`}</span>
          </button>
        </section>
      </nav>

      <main>
        <Preview skin={previewSkin} defaults={defaults} note={note} />

        {current ? (
          <div className="browser">
            <div className="browser-head">
              <h2>{current.label}</h2>
              <span className="muted">
                {current.hint}. Click a skin's name to use it for all of these, or a single cell to take just that element. Hover to try.
              </span>
            </div>
            <div className="browser-body">
              <ElementGrid
                key={current.id}
                category={current}
                skins={loaded.sources}
                none={canBeNone(current.id) ? noneSkin : null}
                categorySource={sourceFor(selection, current.id, skinsById)?.id ?? null}
                elementSources={selection.elements[current.id] ?? {}}
                base={selection.base}
                colourOf={colourOf}
                onSelectCategory={(skinId) => chooseCategory(current.id, skinId)}
                onSelectElement={(element, skinId) => chooseElement(current.id, element, skinId)}
                onHover={setHover}
              />
              <IniPanel category={current} inherited={inherited} overrides={selection.ini} onChange={setIni} />
            </div>
          </div>
        ) : (
          <div className="browser">
            <div className="browser-head">
              <h2>skin.ini overrides</h2>
              <span className="muted">Set any skin.ini value yourself, whatever the skins you picked say.</span>
            </div>
            <IniEditor result={mix?.ini ?? []} inherited={inherited} overrides={selection.ini} onChange={setIni} />
          </div>
        )}
      </main>
    </div>
  );
}
