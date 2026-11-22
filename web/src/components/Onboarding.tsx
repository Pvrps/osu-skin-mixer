import { Brand } from "./Brand";
import { useMemo, useState } from "react";
import type { ElementIndex } from "../lib/elements";
import { representative } from "../lib/elements";
import { type Skin, fileUrl } from "../lib/skins";
import { Thumb } from "./Thumb";

interface Props {
  skins: Skin[];
  index: ElementIndex;
  osuDir: string;
  onCreate: (name: string, baseId: string, adoptId: string | null) => void;
}

/** Skins made by the mixer carry this as their creator. */
const MIXER_CREATOR = "osu-skin-mixer";

// A handful of elements which say the most about how a skin looks.
const SHOWCASE = [
  ["cursor", "cursor"],
  ["hitcircle", "hitcircle"],
  ["hitcircle", "approachcircle"],
  ["judgement", "hit300"],
  ["slider", "sliderb"],
] as const;

export function Onboarding({ skins, index, osuDir, onCreate }: Props) {
  const [name, setName] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const trimmed = name.trim();
  const clash = skins.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const adopt = clash && clash.creator === MIXER_CREATOR ? clash : null;
  const taken = clash !== undefined && !adopt;

  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () => skins.filter((s) => s.id !== adopt?.id && (needle === "" || s.name.toLowerCase().includes(needle) || s.creator.toLowerCase().includes(needle))),
    [skins, adopt, needle],
  );

  const ready = trimmed.length > 0 && !taken && base !== null && base !== adopt?.id;

  if (skins.length === 0) {
    return (
      <div className="onboarding">
        <div className="onboarding-card">
          <h1>No skins to mix yet</h1>
          <p className="muted">
            No skins were found in <code>{osuDir}</code>. Import some into osu! and reload this page.
          </p>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <form
        className="onboarding-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onCreate(trimmed, base, adopt?.id ?? null);
        }}
      >
        <Brand />
        <h1>Create your mix</h1>
        <p className="muted">
          Your mix is a new skin of its own. It starts as a copy of a skin you already have, and from there you can swap in any element from
          any of your other skins. The skins you take from are never changed.
        </p>

        <label className="field">
          <span>Name</span>
          <input type="text" autoFocus spellCheck={false} maxLength={100} placeholder="What to call it in osu!" value={name} onChange={(e) => setName(e.target.value)} />
          {taken && <small className="error">You already have a skin called "{clash.name}". Pick a different name.</small>}
          {adopt && <small>A mix with this name already exists in osu!. It will be replaced.</small>}
        </label>

        <div className="field">
          <span>Start from</span>
          {skins.length > 8 && <input type="search" placeholder={`Search ${skins.length} skins`} value={filter} onChange={(e) => setFilter(e.target.value)} />}
          <div className="skin-choices">
            {shown.map((skin) => (
              <button type="button" key={skin.id} className={`skin-choice${skin.id === base ? " selected" : ""}`} aria-pressed={skin.id === base} onClick={() => setBase(skin.id)}>
                <span className="skin-choice-thumbs">
                  {SHOWCASE.map(([group, element]) => {
                    const files = index.get(group)?.get(element)?.bySkin.get(skin.id);
                    return <Thumb key={element} kind="image" url={files ? fileUrl(representative(files).source) : null} />;
                  })}
                </span>
                <span className="skin-choice-name">{skin.name}</span>
                <span className="muted">{skin.creator ? `by ${skin.creator}` : `${skin.files.length} files`}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="muted">No skin matches "{filter}".</p>}
          </div>
        </div>

        <div className="onboarding-actions">
          <span className="muted">Nothing is written to osu! until you press Apply.</span>
          <button type="submit" className="primary" disabled={!ready}>
            Start mixing
          </button>
        </div>
      </form>
    </div>
  );
}
