import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetBrowser } from "./components/AssetBrowser";
import { IniPanel } from "./components/IniPanel";
import { Preview } from "./components/Preview";
import { applyMix, fetchDefaultIndex, fetchState, saveSelection } from "./lib/api";
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from "./lib/categories";
import { type Selection, computeMix, isApplied, mixAsSkin, sourceFor } from "./lib/mix";
import { type Skin, loadSkin } from "./lib/skins";

interface Loaded {
  mixName: string;
  osuDir: string;
  sources: Skin[];
  mix: Skin | null;
}

type Status = { kind: "idle" } | { kind: "applying" } | { kind: "applied"; created: boolean } | { kind: "error"; message: string };

const GROUPS = ["Gameplay", "HUD", "Audio", "Everything else"] as const;

/** Drops anything in a saved selection which refers to a skin that no longer exists. */
function sanitise(saved: Partial<Selection> | null, sources: Skin[]): Selection {
  const known = new Set(sources.map((s) => s.id));
  const overrides: Selection["overrides"] = {};

  for (const [category, skinId] of Object.entries(saved?.overrides ?? {})) {
    if (CATEGORY_BY_ID.has(category as CategoryId) && typeof skinId === "string" && known.has(skinId)) overrides[category as CategoryId] = skinId;
  }

  const ini: Record<string, string> = {};

  for (const [path, value] of Object.entries(saved?.ini ?? {})) {
    if (typeof value === "string") ini[path] = value;
  }

  return { base: saved?.base && known.has(saved.base) ? saved.base : null, overrides, ini };
}

async function load(): Promise<{ loaded: Loaded; selection: Selection }> {
  const state = await fetchState();
  const skins = await Promise.all(state.skins.map(loadSkin));
  const sources = skins.filter((s) => !s.isMix).sort((a, b) => a.name.localeCompare(b.name));

  return {
    loaded: { mixName: state.mixName, osuDir: state.osuDir, sources, mix: skins.find((s) => s.isMix) ?? null },
    selection: sanitise(state.selection, sources),
  };
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Set<string> | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [category, setCategory] = useState<CategoryId>("cursor");
  const [hover, setHover] = useState<string | null>(null);
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

  const skinsById = useMemo(() => new Map((loaded?.sources ?? []).map((s) => [s.id, s])), [loaded]);

  const colourOf = useCallback(
    (skinId: string) => {
      const index = Math.max(0, (loaded?.sources ?? []).findIndex((s) => s.id === skinId));
      return `hsl(${(index * 137.5 + 265) % 360} 75% 68%)`;
    },
    [loaded],
  );

  const mix = useMemo(
    () => (loaded && selection ? computeMix(loaded.sources, selection, loaded.mixName, loaded.mix) : null),
    [loaded, selection],
  );

  // What each setting would be without manual values, shown as the placeholder in the settings panel.
  const inherited = useMemo(
    () => (loaded && selection ? (computeMix(loaded.sources, { ...selection, ini: {} }, loaded.mixName, loaded.mix)?.ini ?? []) : []),
    [loaded, selection],
  );

  // Hovering a skin's card shows what the mix would look like with it, without committing to anything.
  const previewSkin = useMemo(() => {
    if (!loaded || !selection) return null;

    const shown =
      hover && hover !== sourceFor(selection, category, skinsById)?.id
        ? computeMix(loaded.sources, { ...selection, overrides: { ...selection.overrides, [category]: hover } }, loaded.mixName, loaded.mix)
        : mix;

    return shown ? mixAsSkin(shown, loaded.mixName) : null;
  }, [loaded, selection, hover, category, skinsById, mix]);

  const dirty = mix !== null && !isApplied(mix, loaded?.mix);

  const update = (change: (s: Selection) => Selection) => {
    setSelection((s) => (s ? change(s) : s));
    setStatus((s) => (s.kind === "applying" ? s : { kind: "idle" }));
  };

  const choose = (categoryId: CategoryId, skinId: string) =>
    update((s) => {
      const overrides = { ...s.overrides };

      if (skinId === s.base) delete overrides[categoryId];
      else overrides[categoryId] = skinId;

      return { ...s, overrides };
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

  const current = CATEGORY_BY_ID.get(category)!;
  const currentSource = sourceFor(selection, category, skinsById);
  const overrideCount = Object.keys(selection.overrides).length + Object.keys(selection.ini).length;
  const hoverName = hover && hover !== currentSource?.id ? skinsById.get(hover)?.name : null;

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

        <button className="quiet" disabled={overrideCount === 0} onClick={() => update((s) => ({ ...s, overrides: {}, ini: {} }))}>
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
          {status.kind === "idle" && (dirty ? (loaded.mix ? "Changes not applied yet" : `"${loaded.mixName}" will be created`) : `"${loaded.mixName}" is up to date`)}
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

              return (
                <button
                  key={c.id}
                  className={`category${c.id === category ? " active" : ""}`}
                  style={{ "--skin": source ? colourOf(source.id) : "transparent" } as React.CSSProperties}
                  onClick={() => {
                    setCategory(c.id);
                    setHover(null);
                  }}
                >
                  <span className="category-label">{c.label}</span>
                  <span className={`category-source${overridden ? " overridden" : ""}`}>
                    <span className="dot" />
                    {source?.name}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </nav>

      <main>
        <Preview skin={previewSkin} defaults={defaults} note={hoverName ? `Trying ${current.label.toLowerCase()} from ${hoverName}` : null} />

        <div className="browser">
          <div className="browser-head">
            <h2>{current.label}</h2>
            <span className="muted">{current.hint}. Hover a skin to try it, click to use it.</span>
          </div>
          <div className="browser-body">
            <AssetBrowser
              category={current}
              skins={loaded.sources}
              selected={currentSource?.id ?? null}
              base={selection.base}
              colourOf={colourOf}
              onSelect={(skinId) => choose(category, skinId)}
              onHover={setHover}
            />
            <IniPanel category={current} inherited={inherited} overrides={selection.ini} onChange={setIni} />
          </div>
        </div>
      </main>
    </div>
  );
}
